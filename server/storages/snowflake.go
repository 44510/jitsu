package storages

import (
	"context"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/typing"
	sf "github.com/snowflakedb/gosnowflake"
	"time"
)

//Snowflake stores files to Snowflake in two modes:
//batch: via aws s3 (or gcp) in batch mode (1 file = 1 transaction)
//stream: via events queue in stream mode (1 object = 1 transaction)
type Snowflake struct {
	Abstract

	stageAdapter                  adapters.Stage
	snowflakeAdapter              *adapters.Snowflake
	streamingWorker               *StreamingWorker
	usersRecognitionConfiguration *UserRecognitionConfiguration
	suspender					  *SnowflakeSuspender
}

func init() {
	RegisterStorage(SnowflakeType, NewSnowflake)
}

//NewSnowflake returns Snowflake and start goroutine for Snowflake batch storage or for stream consumer depend on destination mode
func NewSnowflake(config *Config) (Storage, error) {
	snowflakeConfig := config.destination.Snowflake
	if err := snowflakeConfig.Validate(); err != nil {
		return nil, err
	}
	if snowflakeConfig.Schema == "" {
		snowflakeConfig.Schema = "PUBLIC"
		logging.Warnf("[%s] schema wasn't provided. Will be used default one: %s", config.destinationID, snowflakeConfig.Schema)
	}
	var suspender *SnowflakeSuspender
	if snowflakeConfig.AutoSuspendSec > 0 {
		dur := time.Duration(time.Second.Nanoseconds()*int64(snowflakeConfig.AutoSuspendSec))
		var err error
		suspender, err = AcquireSnowflakeSuspender(snowflakeConfig, dur, config.monitorKeeper)
		if err != nil {
			return nil, fmt.Errorf("failed to start Auto Suspender: %v", err)
		}
	}

	//default client_session_keep_alive
	if _, ok := snowflakeConfig.Parameters["client_session_keep_alive"]; !ok {
		t := "true"
		snowflakeConfig.Parameters["client_session_keep_alive"] = &t
	}

	if config.destination.Google != nil {
		if err := config.destination.Google.Validate(config.streamMode); err != nil {
			return nil, err
		}
		//stage is required when gcp integration
		if snowflakeConfig.Stage == "" {
			return nil, errors.New("Snowflake stage is required parameter in GCP integration")
		}
	}

	var stageAdapter adapters.Stage
	if !config.streamMode {
		var err error
		if config.destination.S3 != nil {
			stageAdapter, err = adapters.NewS3(config.destination.S3)
			if err != nil {
				return nil, err
			}
		} else {
			stageAdapter, err = adapters.NewGoogleCloudStorage(config.ctx, config.destination.Google)
			if err != nil {
				return nil, err
			}
		}
	}

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	snowflakeAdapter, err := CreateSnowflakeAdapter(config.ctx, config.destination.S3, *snowflakeConfig, queryLogger, config.sqlTypes)
	if err != nil {
		if stageAdapter != nil {
			stageAdapter.Close()
		}
		return nil, err
	}

	tableHelper := NewTableHelper(snowflakeAdapter, config.monitorKeeper, config.pkFields, adapters.SchemaToSnowflake, config.maxColumns)

	snowflake := &Snowflake{
		stageAdapter:                  stageAdapter,
		snowflakeAdapter:              snowflakeAdapter,
		usersRecognitionConfiguration: config.usersRecognition,
	}

	//Abstract
	snowflake.destinationID = config.destinationID
	snowflake.processor = config.processor
	snowflake.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	snowflake.eventsCache = config.eventsCache
	snowflake.tableHelpers = []*TableHelper{tableHelper}
	snowflake.sqlAdapters = []adapters.SQLAdapter{snowflakeAdapter}
	snowflake.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)
	snowflake.uniqueIDField = config.uniqueIDField
	snowflake.staged = config.destination.Staged
	snowflake.cachingConfiguration = config.destination.CachingConfiguration

	//streaming worker (queue reading)
	snowflake.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, snowflake, tableHelper)
	snowflake.streamingWorker.start()
	if suspender != nil {
		snowflake.suspender = suspender
	}

	return snowflake, nil
}

//CreateSnowflakeAdapter creates snowflake adapter with schema
//if schema doesn't exist - snowflake returns error. In this case connect without schema and create it
func CreateSnowflakeAdapter(ctx context.Context, s3Config *adapters.S3Config, config adapters.SnowflakeConfig,
	queryLogger *logging.QueryLogger, sqlTypes typing.SQLTypes) (*adapters.Snowflake, error) {
	snowflakeAdapter, err := adapters.NewSnowflake(ctx, &config, s3Config, queryLogger, sqlTypes)
	if err != nil {
		if sferr, ok := err.(*sf.SnowflakeError); ok {
			//schema doesn't exist
			if sferr.Number == sf.ErrObjectNotExistOrAuthorized {
				snowflakeSchema := config.Schema
				config.Schema = ""
				snowflakeAdapter, err := adapters.NewSnowflake(ctx, &config, s3Config, queryLogger, sqlTypes)
				if err != nil {
					return nil, err
				}
				config.Schema = snowflakeSchema
				//create schema and reconnect
				err = snowflakeAdapter.CreateDbSchema(config.Schema)
				if err != nil {
					return nil, err
				}
				snowflakeAdapter.Close()

				snowflakeAdapter, err = adapters.NewSnowflake(ctx, &config, s3Config, queryLogger, sqlTypes)
				if err != nil {
					return nil, err
				}
				return snowflakeAdapter, nil
			}
		}
		return nil, err
	}
	return snowflakeAdapter, nil
}

func (s *Snowflake) Insert(eventContext *adapters.EventContext) (err error) {
	s.suspender.Touch()
	return s.Abstract.Insert(eventContext)
}

//Store process events and stores with storeTable() func
//returns store result per table, failed events (group of events which are failed to process) and err
func (s *Snowflake) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error) {
	s.suspender.RegisterTaskStart()
	defer s.suspender.RegisterTaskEnd()
	_, tableHelper := s.getAdapters()
	flatData, failedEvents, err := s.processor.ProcessEvents(fileName, objects, alreadyUploadedTables)
	if err != nil {
		return nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		s.eventsCache.Error(s.IsCachingDisabled(), s.ID(), failedEvent.EventID, failedEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range flatData {
		table := tableHelper.MapTableSchema(fdata.BatchHeader)
		err := s.storeTable(fdata, table)
		tableResults[table.Name] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen(), EventsSrc: fdata.GetEventsPerSrc()}
		if err != nil {
			storeFailedEvents = false
		}

		//events cache
		for _, object := range fdata.GetPayload() {
			if err != nil {
				s.eventsCache.Error(s.IsCachingDisabled(), s.ID(), s.uniqueIDField.Extract(object), err.Error())
			} else {
				s.eventsCache.Succeed(s.IsCachingDisabled(), s.ID(), s.uniqueIDField.Extract(object), object, table)
			}
		}
	}

	//store failed events to fallback only if other events have been inserted ok
	if storeFailedEvents {
		return tableResults, failedEvents, nil
	}

	return tableResults, nil, nil
}

//check table schema
//and store data into one table via stage (google cloud storage or s3)
func (s *Snowflake) storeTable(fdata *schema.ProcessedFile, table *adapters.Table) error {
	_, tableHelper := s.getAdapters()
	dbTable, err := tableHelper.EnsureTableWithoutCaching(s.ID(), table)
	if err != nil {
		return err
	}

	b, header := fdata.GetPayloadBytesWithHeader(schema.CsvMarshallerInstance)
	if err := s.stageAdapter.UploadBytes(fdata.FileName, b); err != nil {
		return err
	}

	s.suspender.RegisterTaskStart()
	defer s.suspender.RegisterTaskEnd()
	if err := s.snowflakeAdapter.Copy(fdata.FileName, dbTable.Name, header); err != nil {
		return fmt.Errorf("Error copying file [%s] from stage to snowflake: %v", fdata.FileName, err)
	}

	if err := s.stageAdapter.DeleteObject(fdata.FileName); err != nil {
		logging.SystemErrorf("[%s] file %s wasn't deleted from stage: %v", s.ID(), fdata.FileName, err)
	}

	return nil
}

//GetUsersRecognition returns users recognition configuration
func (s *Snowflake) GetUsersRecognition() *UserRecognitionConfiguration {
	return s.usersRecognitionConfiguration
}

// SyncStore is used in storing chunk of pulled data to Snowflake with processing
func (s *Snowflake) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool) error {
	s.suspender.RegisterTaskStart()
	defer s.suspender.RegisterTaskEnd()
	return syncStoreImpl(s, overriddenDataSchema, objects, timeIntervalValue, cacheTable)
}

//Update uses SyncStore under the hood
func (s *Snowflake) Update(object map[string]interface{}) error {
	s.suspender.Touch()
	return s.SyncStore(nil, []map[string]interface{}{object}, "", true)
}

//Type returns Snowflake type
func (s *Snowflake) Type() string {
	return SnowflakeType
}

//Close closes Snowflake adapter, stage adapter, fallback logger and streaming worker
func (s *Snowflake) Close() (multiErr error) {
	if err := s.snowflakeAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing snowflake datasource: %v", s.ID(), err))
	}

	if s.stageAdapter != nil {
		if err := s.stageAdapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing snowflake stage: %v", s.ID(), err))
		}
	}

	if s.streamingWorker != nil {
		if err := s.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", s.ID(), err))
		}
	}

	if s.suspender != nil {
		ReleaseSnowflakeSuspender(s.suspender)
	}

	if err := s.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	return
}
