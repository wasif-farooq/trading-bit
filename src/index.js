const { AnalyzerService } = require('./services/analysis/analyzerService');
const { TradingService } = require('./services/trading/tradingService');
const { CONFIG } = require('./config/config');
const { createServer } = require('./server');
const { connectAerospike, disconnectAerospike } = require('./infrastructure/storage/aerospikeClient');
const { SwingLevelRepository } = require('./repositories/swingLevelRepository');
const { CandleRepository } = require('./repositories/candleRepository');
const { ConfigRepository } = require('./repositories/configRepository');
const { MqlDataSource, BinanceDataSource, ManualDataSource } = require('./infrastructure/data/index');
const logger = require('./utils/logger');

async function main() {
	const args = process.argv.slice(2);
	const symbol = args[0] || 'BTCUSDT';
	const outputDir = args[1] || './live_analysis_output';
	const modeArg = (args[2] || 'mql').toLowerCase();
	const mode = modeArg === 'mt5' ? 'mql' : modeArg;

	logger.info(`🚀 Starting Live Trading Analyzer for ${symbol}`);
	logger.info(`Output directory: ${outputDir}`);
	logger.info(`Data source: ${mode}`);

	let tradingService;
	let apiServer;
	let aerospikeClient;
	let swingLevelRepository;
	let configRepository;

	let dataSource;

	switch (mode) {
		case 'mql':
		case 'mt5':
			dataSource = new MqlDataSource({
				symbol,
				...CONFIG.mql
			});
			break;
		case 'binance':
			dataSource = new BinanceDataSource({
				symbol
			});
			break;
		case 'manual':
			const simulationUrl = CONFIG.simulation.url;
			dataSource = new ManualDataSource({
				symbol,
				initialPrice: 50000,
				volatility: 100,
				intervalMs: 1000,
				simulationServerUrl: simulationUrl || null
			});
			if (simulationUrl) {
				logger.info(`Using simulation server: ${simulationUrl}`);
			} else {
				logger.info('Using random data generation (no simulation server configured)');
			}
			break;
		default:
			logger.warn(`Unknown mode "${modeArg}". Defaulting to MQL.`);
			dataSource = new MqlDataSource({
				symbol,
				...CONFIG.mql
			});
	}

	try {
		aerospikeClient = await connectAerospike();
	} catch (error) {
		logger.error('Failed to connect to Aerospike:', error);
		logger.warn('Continuing without Aerospike persistence...');
		aerospikeClient = null;
	}

	swingLevelRepository = new SwingLevelRepository({
		namespace: 'swing_levels',
		fallbackToFile: true
	});

	if (aerospikeClient) {
		try {
			await swingLevelRepository.ensurePriceIndex();
			logger.info('✅ Price index verified/created');
		} catch (error) {
			logger.error('⚠️  Failed to ensure price index:', error);
		}
	}

	// Create candle repositories for 1s and all multi-timeframes
	const candleRepository = aerospikeClient ? new CandleRepository(symbol, 'candles', '1s') : null;
	const multiTimeframeRepositories = aerospikeClient ? {
		'15s': new CandleRepository(symbol, 'candles', '15s'),
		'1m': new CandleRepository(symbol, 'candles', '1m'),
		'3m': new CandleRepository(symbol, 'candles', '3m'),
		'5m': new CandleRepository(symbol, 'candles', '5m')
	} : null;
	
	configRepository = new ConfigRepository();

	const analyzerService = new AnalyzerService(symbol, outputDir, {
		swingLevelRepository,
		candleRepository,
		multiTimeframeRepositories
	});

	tradingService = new TradingService({
		symbol,
		analyzer: analyzerService,
		dataSource,
		priceType: 'bid',
		defaultVolume: CONFIG.defaultVolume
	});
	tradingService.setSymbolSettings(symbol, {
		stopLoss: CONFIG.defaultStopLoss,
		takeProfit: CONFIG.defaultTakeProfit,
		volume: CONFIG.defaultVolume
	});
	tradingService.start();
	apiServer = createServer({
		tradingService,
		analyzerService,
		configRepository,
		port: CONFIG.port
	});
	await apiServer.start();

	process.on('SIGINT', async () => {
		logger.info('\n🛑 Shutting down...');

		if (tradingService) {
			tradingService.stop();
		}
		if (apiServer) {
			await apiServer.stop();
		}

		const status = analyzerService.getStatus();
		logger.info('\n=== FINAL STATUS ===');
		logger.info(`Candles processed: ${status.candlesProcessed}`);
		logger.info(`Common points: ${status.commonPointsCount}`);
		logger.info(`Total signals: ${status.totalSignals}`);
		logger.info(`Buy signals: ${status.buySignals}`);
		logger.info(`Sell signals: ${status.sellSignals}`);

		if (analyzerService.getCandleService()) {
			await analyzerService.getCandleService().shutdown();
		}

		if (aerospikeClient) {
			await disconnectAerospike();
		}

		process.exit(0);
	});

	setInterval(() => {
		const status = analyzerService.getStatus();
		logger.info(`📈 Status: ${status.candlesProcessed} candles | ${status.commonPointsCount} common points | ${status.totalSignals} signals`);
	}, 30000);
}

if (require.main === module) {
	main();
}

module.exports = {
	main
};
