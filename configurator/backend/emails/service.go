package emails

import (
	"bytes"
	"text/template"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/pkg/errors"
	gomail "gopkg.in/mail.v2"
)

var ErrSMTPNotConfigured = errors.New("SMTP isn't configured")

type SMTPConfiguration struct {
	Host      string
	Port      int
	User      string
	Password  string
	From      string
	Signature string
}

func (sc *SMTPConfiguration) Validate() error {
	if sc.Host == "" {
		return errors.New("smtp host is required")
	}

	if sc.Port == 0 {
		return errors.New("smtp port is required")
	}

	if sc.User == "" {
		return errors.New("smtp user is required")
	}

	if sc.From == "" {
		sc.From = "support@jitsu.com"
	}

	if sc.Signature == "" {
		sc.Signature = "Your Jitsu - an open-source data collection platform team"
	}

	return nil
}

type Service struct {
	smtp      *SMTPConfiguration
	templates map[templateSubject]*template.Template
}

func NewService(smtp *SMTPConfiguration) (*Service, error) {
	if smtp == nil {
		return nil, nil
	}

	logging.Info("Initializing SMTP email service..")
	if sc, err := dialer(smtp).Dial(); err != nil {
		logging.Warnf("Invalid SMTP configuration – service is disabled: %v", err)
	} else {
		_ = sc.Close()
	}

	templates, err := parseTemplates()
	if err != nil {
		return nil, errors.Wrap(err, "parse templates")
	}

	return &Service{
		smtp:      smtp,
		templates: templates,
	}, nil
}

func (s *Service) IsConfigured() bool {
	return s != nil
}

func (s *Service) send(subject templateSubject, email, link string) error {
	if !s.IsConfigured() {
		return ErrSMTPNotConfigured
	}

	tmplt, ok := s.templates[subject]
	if !ok {
		return errors.Errorf("unknown email template: '%s'", subject)
	}

	msg := gomail.NewMessage()
	msg.SetHeader("From", s.smtp.From)
	msg.SetHeader("To", email)
	msg.SetHeader("Subject", subject.String())

	var body bytes.Buffer
	if err := tmplt.Execute(&body, templateValues{
		Email:     email,
		Link:      link,
		Signature: s.smtp.Signature,
	}); err != nil {
		return errors.Wrap(err, "execute template")
	}

	msg.SetBody("text/html", body.String())

	dialer := gomail.NewDialer(s.smtp.Host, s.smtp.Port, s.smtp.User, s.smtp.Password)
	if err := dialer.DialAndSend(msg); err != nil {
		return errors.Wrap(err, "dial and send")
	}

	return nil
}

func (s *Service) SendResetPassword(email, link string) error {
	return s.send(resetPassword, email, link)
}

func (s *Service) SendAccountCreated(email, link string) error {
	return s.send(accountCreated, email, link)
}

func dialer(cfg *SMTPConfiguration) *gomail.Dialer {
	return gomail.NewDialer(cfg.Host, cfg.Port, cfg.User, cfg.Password)
}
