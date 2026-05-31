package main

import (
	"database/sql"
	"fmt"
	"os"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://echonotes:echonotes@localhost:5432/echonotes"
	}

	migrationsDir := "sql/migrations"
	if len(os.Args) > 1 {
		migrationsDir = os.Args[1]
	}

	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to open database: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		fmt.Fprintf(os.Stderr, "failed to ping database: %v\n", err)
		os.Exit(1)
	}

	if err := goose.SetDialect("postgres"); err != nil {
		fmt.Fprintf(os.Stderr, "failed to set dialect: %v\n", err)
		os.Exit(1)
	}

	if err := goose.Up(db, migrationsDir); err != nil {
		fmt.Fprintf(os.Stderr, "migration failed: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("migrations applied successfully")
}
