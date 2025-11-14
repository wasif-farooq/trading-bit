const fs = require('fs');
const EventEmitter = require('events');
const { CandleService } = require('./candleService');
const { SignalService } = require('../trading/signalService');
const { MultiTimeframeAnalyzer } = require('./multiTimeframeAnalyzer');
const { SwingAnalyzer } = require('./swingAnalyzer');
const logger = require('../../utils/logger');

class AnalyzerService extends EventEmitter {
	constructor(symbol = 'BTCUSDT', outputDir = './live_analysis', options = {}) {
		super();
		this.symbol = symbol;
		this.outputDir = outputDir;
		this.candleService = new CandleService(symbol, {
			candleRepository: options.candleRepository || null
		});
		this.multiAnalyzer = new MultiTimeframeAnalyzer();
		this.signalService = new SignalService(`${outputDir}/signals.csv`);
		this.isAnalyzing = false;
		this.lastAnalysisTime = 0;
		this.analysisInterval = 60000;
		this.analysisDebounceMs = 5000;
		this.analysisDebounceTimer = null;
		this.candlesSinceAnalysis = 0;
		this.minCandlesForAnalysis = 10;
		this.swingLevelRepository = options.swingLevelRepository || null;

		this.setupOutputDirectory();
		this.setupCandleSubscription();
		this.bootstrapSwingLevels();
		this.restoreCandles();
	}

	async restoreCandles() {
		await this.candleService.restoreRecentCandles(1000);
	}

	setupOutputDirectory() {
		if (!fs.existsSync(this.outputDir)) {
			fs.mkdirSync(this.outputDir, { recursive: true });
		}
	}

	setupCandleSubscription() {
		this.candleService.on('candleStored', (candle) => {
			this.onCandleStored(candle).catch((error) => {
				logger.error('Error handling stored candle:', error);
			});
		});

		this.candleService.subscribe((candle) => {
			logger.debug(`🕯️ New 1s Candle: O:${candle.open.toFixed(2)} H:${candle.high.toFixed(2)} L:${candle.low.toFixed(2)} C:${candle.close.toFixed(2)} V:${candle.volume.toFixed(2)}`);
		});
	}

	async bootstrapSwingLevels() {
		if (!this.swingLevelRepository) {
			return;
		}

		try {
			await this.swingLevelRepository.ensureLoaded();
			const cachedLevels = this.swingLevelRepository.getLevels(this.symbol);
			if (cachedLevels && cachedLevels.length > 0) {
				this.commonPoints = cachedLevels;
				logger.info(`♻️  Loaded ${cachedLevels.length} cached swing levels for ${this.symbol}`);
			}
		} catch (error) {
			logger.error('Failed to bootstrap swing levels:', error);
		}
	}

	async onCandleStored(candle) {
		this.candlesSinceAnalysis++;

		if (this.candlesSinceAnalysis < this.minCandlesForAnalysis) {
			return;
		}

		if (this.analysisDebounceTimer) {
			clearTimeout(this.analysisDebounceTimer);
		}

		this.analysisDebounceTimer = setTimeout(async () => {
			this.triggerAnalysis().catch((error) => {
				logger.error('Error in analysis trigger:', error);
			});
		}, this.analysisDebounceMs);

		this.checkForSignals(candle).catch((error) => {
			logger.error('Error checking signals:', error);
		});
	}

	async checkForSignals(candle) {
		if (!this.swingLevelRepository) {
			return;
		}

		const currentPrice = candle.close;
		const tolerance = 0.002;

		try {
			const relevantLevels = await this.swingLevelRepository.getLevelsInPriceRange(
				this.symbol,
				currentPrice,
				tolerance
			);

			if (relevantLevels.length === 0) {
				return;
			}

			const signals = await this.signalService.checkForSignals(candle, relevantLevels);
			if (signals.length > 0) {
				this.emit('signals', signals, candle);
			}
		} catch (error) {
			logger.error('Error checking signals with price-range query:', error);
		}
	}

	async triggerAnalysis() {
		if (this.isAnalyzing) {
			return;
		}

		const currentTime = Date.now();
		if (currentTime - this.lastAnalysisTime < this.analysisInterval) {
			return;
		}

		await this.performAnalysis();
		this.lastAnalysisTime = currentTime;
		this.candlesSinceAnalysis = 0;
	}

	async performAnalysis() {
		if (this.isAnalyzing) return;

		this.isAnalyzing = true;
		logger.info('🔍 Performing swing analysis...');

		try {
			const allCandles = this.candleService.getAllCandles();

			if (allCandles.length < 100) {
				logger.warn('⚠️ Not enough data for analysis. Waiting for more candles...');
				this.isAnalyzing = false;
				return;
			}

			this.multiAnalyzer = new MultiTimeframeAnalyzer();

			const timeframes = ['1m', '3m', '5m'];

			for (const timeframe of timeframes) {
				logger.debug(`Analyzing ${timeframe} timeframe...`);

				let aggregatedData;
				if (timeframe === '1m') {
					aggregatedData = this.aggregateToTimeframe(allCandles, 60);
				} else if (timeframe === '3m') {
					aggregatedData = this.aggregateToTimeframe(allCandles, 180);
				} else if (timeframe === '5m') {
					aggregatedData = this.aggregateToTimeframe(allCandles, 300);
				} else {
					continue;
				}

				const analyzer = new SwingAnalyzer(timeframe);
				aggregatedData.forEach(bar => {
					analyzer.addPriceData(bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume, bar.originalTimestamp);
				});

				analyzer.detectSwingPoints();
				this.multiAnalyzer.addTimeframe(timeframe, analyzer);
			}

			const commonPoints = this.multiAnalyzer.findCommonSwingPoints();
			logger.info(`📊 Found ${commonPoints.length} common swing points`);

			this.commonPoints = commonPoints;

			if (this.swingLevelRepository) {
				await this.swingLevelRepository.syncLevels(this.symbol, commonPoints);
				logger.info(`💾 Synced ${commonPoints.length} swing levels to Aerospike`);
			}

			const commonOutput = `${this.outputDir}/common_swing_points.csv`;
			await this.multiAnalyzer.exportCommonPointsToCSV(commonOutput);

		} catch (error) {
			logger.error('Error during analysis:', error);
		} finally {
			this.isAnalyzing = false;
		}
	}

	aggregateToTimeframe(candles, seconds) {
		const aggregated = [];
		const barsPerTimeframe = seconds;

		for (let i = 0; i < candles.length; i += barsPerTimeframe) {
			const chunk = candles.slice(i, i + barsPerTimeframe);
			if (chunk.length === 0) continue;

			const firstCandle = chunk[0];
			const lastCandle = chunk[chunk.length - 1];

			const aggregatedBar = {
				timestamp: firstCandle.timestamp,
				open: firstCandle.open,
				high: Math.max(...chunk.map(c => c.high)),
				low: Math.min(...chunk.map(c => c.low)),
				close: lastCandle.close,
				volume: chunk.reduce((sum, c) => sum + c.volume, 0),
				originalTimestamp: lastCandle.originalTimestamp
			};

			aggregated.push(aggregatedBar);
		}

		return aggregated;
	}

	async checkForLiveSignals(currentCandle) {
		if (!this.commonPoints || this.commonPoints.length === 0) return [];

		const signals = await this.signalService.checkForSignals(currentCandle, this.commonPoints);

		if (signals.length > 0) {
			logger.info(`🚨 Generated ${signals.length} live signal(s)`);
		}

		return signals;
	}

	addTradeData(timestamp, price, volume = 0) {
		this.candleService.addData(timestamp, price, volume);
	}

	getStatus() {
		const candleHistory = this.candleService.getCandleHistory();
		const signalSummary = this.signalService.getSignalsSummary();

		return {
			candlesProcessed: candleHistory.length,
			commonPointsCount: this.commonPoints ? this.commonPoints.length : 0,
			totalSignals: signalSummary.totalSignals,
			buySignals: signalSummary.buySignals,
			sellSignals: signalSummary.sellSignals,
			isAnalyzing: this.isAnalyzing
		};
	}

	getSignalService() {
		return this.signalService;
	}

	getCandleService() {
		return this.candleService;
	}
}

module.exports = { AnalyzerService };

