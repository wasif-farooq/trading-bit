const path = require('path');
const dotenv = require('dotenv');

const envPath = process.env.ENV_FILE || path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

const getNumber = (value, fallback) => {
	if (value === undefined || value === null || value === '') {
		return fallback;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};

const getBoolean = (value, fallback = false) => {
	if (value === undefined || value === null) return fallback;
	if (typeof value === 'boolean') return value;
	const normalized = `${value}`.toLowerCase();
	if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
	if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
	return fallback;
};

module.exports = {
	env: process.env.NODE_ENV || 'development',
	port: getNumber(process.env.PORT, 8080),
	mt5: {
		username: process.env.MT5_API_USERNAME || '',
		password: process.env.MT5_API_PASSWORD || ''
	},
	mql: {
		host: process.env.MQL_HOST || '127.0.0.1',
		port: getNumber(process.env.MQL_PORT, 4242),
		heartbeatInterval: getNumber(process.env.MQL_HEARTBEAT_MS, 5000),
		reconnectInterval: getNumber(process.env.MQL_RECONNECT_MS, 3000),
		maxReconnectAttempts: getNumber(process.env.MQL_MAX_RECONNECTS, 10)
	},
	aerospike: {
		host: process.env.AEROSPIKE_HOST || '127.0.0.1',
		port: getNumber(process.env.AEROSPIKE_PORT, 3000),
		user: process.env.AEROSPIKE_USER || '',
		password: process.env.AEROSPIKE_PASSWORD || ''
	},
	defaults: {
		stopLoss: getNumber(process.env.DEFAULT_STOP_LOSS, 0),
		takeProfit: getNumber(process.env.DEFAULT_TAKE_PROFIT, 0),
		volume: getNumber(process.env.DEFAULT_VOLUME, 0.1)
	},
	simulation: {
		host: process.env.SIMULATION_HOST || '127.0.0.1',
		port: getNumber(process.env.SIMULATION_PORT, 8081),
		url: process.env.SIMULATION_URL || null // If set, overrides host:port
	},
	logLevel: process.env.LOG_LEVEL || 'info'
};

