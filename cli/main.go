package main

import (
	"fmt"
	"os"

	"github.com/justtype/cli/internal/app"
)

func main() {
	app := app.New()
	defer app.Close()

	if err := app.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
