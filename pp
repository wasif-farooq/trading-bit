# -----------------------------------------------------------
# Application Environment Configuration Template
# Copy this file to `.env` (or the env file of your choice)
# and adjust values as needed.
# -----------------------------------------------------------

# General application settings
NODE_ENV=development
PORT=8080
SYMBOL=BTCUSDT
OUTPUT_DIR=./live_analysis_output
DATA_SOURCE=manual            # options: mql, binance, manual

# Default trading parameters
DEFAULT_STOP_LOSS=0
DEFAULT_TAKE_PROFIT=0
DEFAULT_VOLUME=0.1

# MQL / MT5 socket bridge
MQL_HOST=127.0.0.1
MQL_PORT=4242
MQL_HEARTBEAT_MS=5000
MQL_RECONNECT_MS=3000
MQL_MAX_RECONNECTS=10
MT5_API_USERNAME=YOUR_MT5_USER
MT5_API_PASSWORD=YOUR_MT5_PASSWORD

# Aerospike configuration
AEROSPIKE_HOST=aerospike
AEROSPIKE_PORT=3000
AEROSPIKE_USER=
AEROSPIKE_PASSWORD=

# Simulation server configuration
SIMULATION_HOST=simulation
SIMULATION_PORT=8081
SIMULATION_URL=ws://simulation:8081
CSV_FILE_PATH=/app/data/ticks.csv
PLAYBACK_SPEED=1.0
# Set FIXED_INTERVAL (in ms) to override CSV timestamps, e.g. 1000 for 1s cadence
FIXED_INTERVAL=

# Logging
LOG_LEVEL=info

