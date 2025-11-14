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
			candleRepository: options.candleRepository || null,
			multiTimeframeRepositories: options.multiTimeframeRepositories || null
		});
		this.multiAnalyzer = new MultiTimeframeAnalyzer();
		this.signalService = new SignalService(`${outputDir}/signals.csv`);
		this.isAnalyzing = false;
		this.lastAnalysisTime = 0;
		this.analysisInterval = 0; // No interval restriction - analyze after every candle
		this.analysisDebounceMs = 0; // No debounce - analyze immediately
		this.analysisDebounceTimer = null;
		this.candlesSinceAnalysis = 0;
		this.minCandlesForAnalysis = 1; // Analyze after just 1 candle
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
		logger.info('🔗 Setting up candle subscription...');
		
		// Test event emission
		this.candleService.once('test', () => {
			logger.info('✅ Event system is working!');
		});
		this.candleService.emit('test');
		
		this.candleService.on('candleStored', (candle) => {
			logger.info(`📥 Received 'candleStored' event in AnalyzerService for candle: ${candle.timestamp}`);
			this.onCandleStored(candle).catch((error) => {
				logger.error('Error handling stored candle:', error);
			});
		});
		logger.info('✅ Candle subscription listener registered');

		this.candleService.subscribe((candle) => {
			logger.info(`🕯️ New 1s Candle: O:${candle.open.toFixed(2)} H:${candle.high.toFixed(2)} L:${candle.low.toFixed(2)} C:${candle.close.toFixed(2)} V:${candle.volume.toFixed(2)}`);
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
		const allCandles = this.candleService.getAllCandles();
		logger.info(`📊 Candle stored. Total candles: ${allCandles.length}, Since last analysis: ${this.candlesSinceAnalysis}`);

		if (this.candlesSinceAnalysis < this.minCandlesForAnalysis) {
			logger.info(`⏳ Waiting for more candles (${this.candlesSinceAnalysis}/${this.minCandlesForAnalysis})`);
			return;
		}

		// Clear any pending debounce timer
		if (this.analysisDebounceTimer) {
			clearTimeout(this.analysisDebounceTimer);
			this.analysisDebounceTimer = null;
		}

		// Trigger analysis immediately (no debounce) or with minimal delay
		if (this.analysisDebounceMs > 0) {
			this.analysisDebounceTimer = setTimeout(async () => {
				logger.info('⏰ Debounce timer expired, triggering analysis...');
				this.triggerAnalysis().catch((error) => {
					logger.error('Error in analysis trigger:', error);
				});
			}, this.analysisDebounceMs);
		} else {
			// No debounce - trigger immediately
			logger.info('🚀 Triggering analysis immediately (no debounce)...');
			this.triggerAnalysis().catch((error) => {
				logger.error('Error in analysis trigger:', error);
			});
		}

		// Check for signals in parallel (doesn't wait for analysis)
		this.checkForSignals(candle).catch((error) => {
			logger.error('Error checking signals:', error);
		});
	}

	async checkForSignals(candle) {
		if (!this.swingLevelRepository) {
			logger.debug('No swing level repository available for signal checking');
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

			logger.info(`🔍 Signal check: Current price: ${currentPrice.toFixed(2)}, Tolerance: ${tolerance}, Found ${relevantLevels.length} relevant levels`);

			if (relevantLevels.length === 0) {
				logger.info(`⚠️  No swing levels found within ${(tolerance * 100).toFixed(2)}% of current price ${currentPrice.toFixed(2)}`);
				return;
			}

			// Log the relevant levels for debugging
			relevantLevels.forEach(level => {
				const priceDiff = Math.abs(currentPrice - level.price) / level.price;
				logger.info(`  📍 Level: ${level.type} @ ${level.price.toFixed(2)}, Diff: ${(priceDiff * 100).toFixed(3)}%`);
			});

			const signals = await this.signalService.checkForSignals(candle, relevantLevels);
			if (signals.length > 0) {
				logger.info(`🚨 Generated ${signals.length} signal(s) from ${relevantLevels.length} relevant levels`);
				this.emit('signals', signals, candle);
			} else {
				logger.info(`✅ Checked ${relevantLevels.length} levels but no signals generated (may be already processed or outside tolerance)`);
			}
		} catch (error) {
			logger.error('Error checking signals with price-range query:', error);
		}
	}

	async triggerAnalysis() {
		if (this.isAnalyzing) {
			logger.info('⏸️  Analysis already in progress, skipping...');
			return;
		}

		const currentTime = Date.now();
		// Only check interval if it's set (0 means no restriction)
		if (this.analysisInterval > 0 && currentTime - this.lastAnalysisTime < this.analysisInterval) {
			const timeSinceLastAnalysis = currentTime - this.lastAnalysisTime;
			logger.info(`⏸️  Analysis interval not met (${timeSinceLastAnalysis}ms < ${this.analysisInterval}ms), skipping...`);
			return;
		}

		logger.info('🎯 Analysis trigger called, starting analysis...');
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

			// Minimum candles needed for meaningful swing analysis (need at least some data for aggregation)
			// Reduced from 100 to allow analysis with fewer candles
			const minCandlesForSwingAnalysis = 50;
			if (allCandles.length < minCandlesForSwingAnalysis) {
				logger.info(`⏳ Not enough candles for swing analysis (${allCandles.length}/${minCandlesForSwingAnalysis}). Waiting for more...`);
				this.isAnalyzing = false;
				return;
			}
			
			logger.info(`✅ Starting analysis with ${allCandles.length} candles`);

			this.multiAnalyzer = new MultiTimeframeAnalyzer();

			const timeframes = [
				{ label: '15s', seconds: 15 },
				{ label: '1m', seconds: 60 },
				{ label: '3m', seconds: 180 },
				{ label: '5m', seconds: 300 }
			];

			// Get multi-timeframe service from candleService
			const multiTimeframeService = this.candleService.getMultiTimeframeService();
			
			for (const { label, seconds } of timeframes) {
				logger.debug(`Analyzing ${label} timeframe...`);

				// Try to get candles from multi-timeframe service (persisted or in-memory)
				let timeframeCandles = null;
				if (multiTimeframeService) {
					timeframeCandles = multiTimeframeService.getCandles(label);
					logger.info(`[${label}] Retrieved ${timeframeCandles.length} candles from multi-timeframe service`);
					
					// If we have some candles from the service, use them
					// Otherwise, fall back to aggregation
					if (timeframeCandles.length > 0) {
						logger.info(`[${label}] Using ${timeframeCandles.length} persisted candles for analysis`);
					} else {
						logger.debug(`[${label}] No persisted candles in ring buffer, will aggregate from 1s candles`);
					}
				}

				// Fallback to on-the-fly aggregation if no persisted candles available
				if (!timeframeCandles || timeframeCandles.length === 0) {
					logger.debug(`[${label}] Aggregating from 1s candles...`);
					timeframeCandles = this.aggregateToTimeframe(allCandles, seconds);
					logger.info(`[${label}] Aggregated ${timeframeCandles.length} bars from ${allCandles.length} 1s candles`);
				}

				if (!timeframeCandles || timeframeCandles.length === 0) {
					logger.debug(`Skipping ${label} timeframe due to insufficient candles`);
					continue;
				}

				const analyzer = new SwingAnalyzer(label);
				timeframeCandles.forEach(bar => {
					analyzer.addPriceData(bar.timestamp, bar.open, bar.high, bar.low, bar.close, bar.volume, bar.originalTimestamp);
				});

				analyzer.detectSwingPoints();
				const swingPoints = analyzer.getSwingPoints();
				logger.info(`[${label}] Detected ${swingPoints.length} swing points`);
				this.multiAnalyzer.addTimeframe(label, analyzer);
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

