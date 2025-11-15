const env = require('./env');

const CONFIG = {
	swingLeftBars: 5,
	swingRightBars: 5,
	minSwingStrength: 0.1, // 10% threshold - matches proven backtest algorithm
	commonPointTolerance: 0.001,
	openCloseTolerance: 0.002,
	volumeSimilarityThreshold: 0.3,
	signalRevisitTolerance: 0.002,
	signalExpiryBars: 20,
	minSignalStrength: 2,
	live: {
		candleInterval: 1000,
		maxHistoryBars: 10000,
		dataBufferSize: 500,
		saveInterval: 5000,
		reconnectDelay: 3000
	},
	mql: {
		host: env.mql.host,
		port: env.mql.port,
		heartbeatInterval: env.mql.heartbeatInterval,
		reconnectInterval: env.mql.reconnectInterval,
		maxReconnectAttempts: env.mql.maxReconnectAttempts,
		username: env.mt5.username,
		password: env.mt5.password
	},
	aerospike: {
		host: env.aerospike.host,
		port: env.aerospike.port,
		user: env.aerospike.user,
		password: env.aerospike.password
	},
	defaultStopLoss: env.defaults.stopLoss,
	defaultTakeProfit: env.defaults.takeProfit,
	defaultVolume: env.defaults.volume,
	port: env.port,
	simulation: {
		host: env.simulation.host,
		port: env.simulation.port,
		url: env.simulation.url || `ws://${env.simulation.host}:${env.simulation.port}`
	}
};

module.exports = { CONFIG };

