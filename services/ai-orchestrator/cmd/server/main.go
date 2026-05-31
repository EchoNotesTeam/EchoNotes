package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/echonotes/ai-orchestrator/internal/api"
	"github.com/echonotes/ai-orchestrator/internal/jobs"
	"github.com/echonotes/ai-orchestrator/internal/ml"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

func main() {
	log := zerolog.New(os.Stdout).With().Timestamp().Logger()

	databaseURL := envOrDefault("DATABASE_URL", "postgres://echonotes:echonotes@localhost:5432/echonotes")
	redisURL := envOrDefault("REDIS_URL", "redis://localhost:6379")
	mlBaseURL := envOrDefault("ML_BASE_URL", "http://localhost:8000")
	internalToken := envOrDefault("INTERNAL_TOKEN", "")
	artifactRoot := envOrDefault("ARTIFACT_ROOT", "/var/echonotes")
	port := envOrDefault("PORT", "8080")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to database")
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		log.Fatal().Err(err).Msg("failed to ping database")
	}
	log.Info().Msg("connected to database")

	redisOpt, err := asynq.ParseRedisURI(redisURL)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to parse redis url")
	}

	asynqClient := asynq.NewClient(redisOpt)
	defer asynqClient.Close()

	pubsub := jobs.NewPubSub()
	mlClient := ml.NewClient(mlBaseURL)

	worker := jobs.NewWorker(pool, mlClient, pubsub, artifactRoot, log)

	if err := worker.RecoverStalledJobs(ctx, asynqClient); err != nil {
		log.Error().Err(err).Msg("failed to recover stalled jobs")
	}

	srv := asynq.NewServer(redisOpt, asynq.Config{
		Concurrency: 3,
		Queues:      map[string]int{"default": 1},
	})

	mux := asynq.NewServeMux()
	mux.HandleFunc(jobs.TaskTypeTranscribe, worker.HandleTranscribe)

	go func() {
		if err := srv.Run(mux); err != nil {
			log.Fatal().Err(err).Msg("asynq server failed")
		}
	}()
	log.Info().Msg("asynq worker started")

	apiServer := api.NewServer(pool, asynqClient, pubsub, mlClient, internalToken, log)

	httpServer := &http.Server{
		Addr:         ":" + port,
		Handler:      apiServer,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 5 * time.Minute,
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		log.Info().Str("port", port).Msg("http server started")
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal().Err(err).Msg("http server failed")
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info().Msg("shutting down")
	srv.Shutdown()

	shutdownCtx, shutdownCancel := context.WithTimeout(ctx, 10*time.Second)
	defer shutdownCancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Error().Err(err).Msg("http server shutdown error")
	}
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
