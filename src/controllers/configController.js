const { CONFIG } = require('../config/config');
const logger = require('../utils/logger');

function createConfigController(tradingService, configRepository) {
	const normalizeSymbol = (symbol) => symbol.toUpperCase();

	const ensureConfigLoaded = async () => {
		await configRepository.load();
		const symbolKey = normalizeSymbol(tradingService.symbol);
		const existing = configRepository.get(symbolKey);
		if (existing) {
			tradingService.setSymbolSettings(symbolKey, existing);
		} else {
			const defaults = {
				stopLoss: CONFIG.defaultStopLoss,
				takeProfit: CONFIG.defaultTakeProfit,
				volume: CONFIG.defaultVolume
			};
			configRepository.set(symbolKey, defaults);
			tradingService.setSymbolSettings(symbolKey, defaults);
			await configRepository.persist(symbolKey, defaults);
		}
	};

	return {
		getAll: async (req, res, next) => {
			try {
				await ensureConfigLoaded();
				res.json({
					symbols: configRepository.getAll()
				});
			} catch (error) {
				next(error);
			}
		},

		get: async (req, res, next) => {
			try {
				await ensureConfigLoaded();
				const symbol = normalizeSymbol(req.params.symbol);
				const settings = configRepository.get(symbol);
				if (!settings) {
					return res.status(404).json({ error: `No settings found for ${symbol}` });
				}
				res.json({ symbol, settings });
			} catch (error) {
				next(error);
			}
		},

		update: async (req, res, next) => {
			try {
				await ensureConfigLoaded();
				const symbol = normalizeSymbol(req.params.symbol);
				const { stopLoss, takeProfit, volume, autoTrade = true } = req.body || {};

				const numericStopLoss = Number.parseFloat(stopLoss ?? CONFIG.defaultStopLoss);
				const numericTakeProfit = Number.parseFloat(takeProfit ?? CONFIG.defaultTakeProfit);
				const numericVolume = Number.parseFloat(volume ?? CONFIG.defaultVolume);

				if (Number.isNaN(numericStopLoss) || Number.isNaN(numericTakeProfit) || Number.isNaN(numericVolume)) {
					return res.status(400).json({ error: 'stopLoss, takeProfit, and volume must be numbers' });
				}

				const newSettings = {
					stopLoss: numericStopLoss,
					takeProfit: numericTakeProfit,
					volume: numericVolume,
					autoTrade: Boolean(autoTrade)
				};

				configRepository.set(symbol, newSettings);
				tradingService.setSymbolSettings(symbol, newSettings);
				await configRepository.persist(symbol, newSettings);

				res.json({ symbol, settings: newSettings });
			} catch (error) {
				next(error);
			}
		},

		delete: async (req, res, next) => {
			try {
				await ensureConfigLoaded();
				const symbol = normalizeSymbol(req.params.symbol);
				configRepository.delete(symbol);
				tradingService.removeSymbolSettings(symbol);
				await configRepository.remove(symbol);
				res.status(204).end();
			} catch (error) {
				next(error);
			}
		}
	};
}

module.exports = { createConfigController };

