package handlers

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/ssl"
	"github.com/jitsucom/jitsu/server/logging"
	jmdlwr "github.com/jitsucom/jitsu/server/middleware"
	"net/http"
	"strings"
)

type CustomDomainHandler struct {
	updateExecutor *ssl.UpdateExecutor
}

func NewCustomDomainHandler(executor *ssl.UpdateExecutor) *CustomDomainHandler {
	return &CustomDomainHandler{executor}
}

func (h *CustomDomainHandler) PerProjectHandler(c *gin.Context) {
	projectID := c.Query("project_id")
	if projectID == "" {
		c.JSON(http.StatusBadRequest, jmdlwr.ErrResponse(ErrProjectIDRequired.Error(), nil))
		return
	}

	if !hasAccessToProject(c, projectID) {
		c.AbortWithStatusJSON(http.StatusForbidden, middleware.ForbiddenProject(projectID))
		return
	}

	async := false
	if strings.ToLower(c.Query("async")) == "true" {
		async = true
	}

	if async {
		go h.runSSLUpdate(projectID)
		c.JSON(http.StatusOK, middleware.OkResponse{Status: "scheduled SSL update"})
		return
	}

	err := h.updateExecutor.RunForProject(projectID)
	if err != nil {
		c.JSON(http.StatusBadRequest, jmdlwr.ErrResponse(fmt.Sprintf("Error running SSL update for project [%s]", projectID), err))
		return
	}

	c.JSON(http.StatusOK, middleware.OkResponse{Status: "ok"})
}

func (h *CustomDomainHandler) AllHandler(c *gin.Context) {
	async := false
	if strings.ToLower(c.Query("async")) == "true" {
		async = true
	}
	if async {
		go h.runAllSSLUpdate()
		c.JSON(http.StatusOK, middleware.OkResponse{Status: "scheduled SSL update"})
		return
	}

	err := h.updateExecutor.Run()
	if err != nil {
		c.JSON(http.StatusBadRequest, jmdlwr.ErrResponse("Error running SSL update", err))
		return
	}
	c.JSON(http.StatusOK, middleware.OkResponse{Status: "ok"})
}

func (h *CustomDomainHandler) runSSLUpdate(projectID string) {
	if err := h.updateExecutor.RunForProject(projectID); err != nil {
		logging.Errorf("Error updating SSL for project [%s]: %v", projectID, err)
	}
}

func (h *CustomDomainHandler) runAllSSLUpdate() {
	if err := h.updateExecutor.Run(); err != nil {
		logging.Errorf("Error updating all SSL: %v", err)
	}
}
