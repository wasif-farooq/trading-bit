const express = require('express');
const { getHealth } = require('../controllers/healthController');
const { createConfigController } = require('../controllers/configController');
const { createTradesController } = require('../controllers/tradesController');
const { createSignalsController } = require('../controllers/signalsController');
const { getStatus } = require('../controllers/statusController');

function createApiRoutes(tradingService, analyzerService, configRepository) {
	const router = express.Router();

	const configController = createConfigController(tradingService, configRepository);
	const tradesController = createTradesController(tradingService);
	const signalsController = createSignalsController(analyzerService);

	router.get('/health', getHealth(tradingService, analyzerService));
	router.get('/status', getStatus(tradingService, analyzerService));

	router.get('/config/symbols', configController.getAll);
	router.get('/config/symbols/:symbol', configController.get);
	router.put('/config/symbols/:symbol', configController.update);
	router.delete('/config/symbols/:symbol', configController.delete);

	router.get('/trades/open', tradesController.getOpen);
	router.get('/trades/history', tradesController.getHistory);

	router.get('/signals/summary', signalsController.getSummary);

	return router;
}

module.exports = { createApiRoutes };

