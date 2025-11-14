const express = require('express');
const logger = require('./utils/logger');
const { createApiRoutes } = require('./routes/apiRoutes');

function createServer({ tradingService, analyzerService, configRepository, port = 8080 }) {
	if (!tradingService) {
		throw new Error('API server requires a TradingService instance');
	}
	if (!analyzerService) {
		throw new Error('API server requires an AnalyzerService instance');
	}
	if (!configRepository) {
		throw new Error('API server requires a ConfigRepository instance');
	}

	const app = express();
	app.use(express.json());

	const apiRoutes = createApiRoutes(tradingService, analyzerService, configRepository);
	app.use('/', apiRoutes);

	app.use((err, req, res, next) => {
		logger.error('API error:', err);
		res.status(500).json({ error: err.message || 'Internal server error' });
	});

	let serverInstance;

	return {
		app,
		async start() {
			return new Promise((resolve) => {
				serverInstance = app.listen(port, () => {
					logger.info(`📡 API server listening on port ${port}`);
					resolve();
				});
			});
		},
		async stop() {
			if (!serverInstance) return;
			return new Promise((resolve, reject) => {
				serverInstance.close((error) => {
					if (error) reject(error);
					else resolve();
				});
			});
		}
	};
}

module.exports = { createServer };
