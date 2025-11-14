const fs = require('fs');
const { createObjectCsvWriter } = require('csv-writer');
const { CONFIG } = require('../../config/config');
const logger = require('../../utils/logger');

class SignalService {
	constructor(outputFile = './live_signals.csv') {
		this.signals = [];
		this.processedLevels = new Map();
		this.outputFile = outputFile;
		this.setupCSVWriter();
		this.lastSaveTime = Date.now();
	}

	setupCSVWriter() {
		this.csvWriter = createObjectCsvWriter({
			path: this.outputFile,
			header: [
				{ id: 'timestamp', title: 'TIMESTAMP' },
				{ id: 'candleTimestamp', title: 'CANDLE_TIMESTAMP' },
				{ id: 'signalType', title: 'SIGNAL_TYPE' },
				{ id: 'commonPointType', title: 'COMMON_POINT_TYPE' },
				{ id: 'commonPointPrice', title: 'COMMON_POINT_PRICE' },
				{ id: 'currentPrice', title: 'CURRENT_PRICE' },
				{ id: 'strength', title: 'STRENGTH' },
				{ id: 'qualityScore', title: 'QUALITY_SCORE' },
				{ id: 'timeframes', title: 'TIMEFRAMES' },
				{ id: 'volume', title: 'VOLUME' },
				{ id: 'barRange', title: 'BAR_RANGE' },
				{ id: 'signalStrength', title: 'SIGNAL_STRENGTH' },
				{ id: 'confidence', title: 'CONFIDENCE' },
				{ id: 'buySignal', title: 'BUY_SIGNAL' },
				{ id: 'sellSignal', title: 'SELL_SIGNAL' }
			],
			append: fs.existsSync(this.outputFile)
		});
	}

	async checkForSignals(currentCandle, commonPoints) {
		const newSignals = [];
		const currentPrice = currentCandle.close;
		const currentTime = new Date(currentCandle.timestamp);

		for (const commonPoint of commonPoints) {
			const commonPointTime = new Date(commonPoint.originalTimestamp || commonPoint.timestamp);

			if (commonPointTime >= currentTime) continue;

			const levelKey = this.getLevelKey(commonPoint);
			if (this.processedLevels.has(levelKey)) continue;

			const priceDiff = Math.abs(currentPrice - commonPoint.price) / commonPoint.price;

			if (priceDiff <= CONFIG.signalRevisitTolerance) {
				const signal = this.createSignal(commonPoint, currentCandle, 'REVISIT');
				newSignals.push(signal);

				this.processedLevels.set(levelKey, {
					timestamp: signal.timestamp,
					price: commonPoint.price,
					type: commonPoint.type,
					signalType: signal.signalType
				});

				logger.info(`🎯 LIVE SIGNAL DETECTED: ${signal.signalType} | ${commonPoint.type} @ ${commonPoint.price.toFixed(4)} | Current: ${currentPrice.toFixed(4)}`);
			}
		}

		if (newSignals.length > 0) {
			this.signals.push(...newSignals);
			await this.saveSignalsToCSV(newSignals);
		}

		return newSignals;
	}

	getLevelKey(commonPoint) {
		const priceKey = Math.round(commonPoint.price * 100);
		return `${commonPoint.type}_${priceKey}`;
	}

	createSignal(commonPoint, currentCandle, signalType) {
		const { buySignal, sellSignal } = this.determineBuySellSignals(commonPoint, signalType);

		return {
			timestamp: new Date().toISOString(),
			candleTimestamp: currentCandle.timestamp,
			signalType: signalType,
			commonPointType: commonPoint.type,
			commonPointPrice: commonPoint.price,
			currentPrice: currentCandle.close,
			strength: commonPoint.confirmationCount,
			qualityScore: commonPoint.qualityScore,
			timeframes: commonPoint.timeframes.join(','),
			volume: currentCandle.volume,
			barRange: currentCandle.high - currentCandle.low,
			signalStrength: this.calculateSignalStrength(commonPoint, currentCandle, signalType),
			confidence: this.calculateConfidenceLevel(commonPoint, currentCandle),
			buySignal,
			sellSignal
		};
	}

	determineBuySellSignals(commonPoint, signalType) {
		let buySignal = false;
		let sellSignal = false;

		switch (signalType) {
			case 'REVISIT':
				if (commonPoint.type === 'SWING_LOW') {
					buySignal = true;
				} else if (commonPoint.type === 'SWING_HIGH') {
					sellSignal = true;
				}
				break;
			default:
				break;
		}

		return { buySignal, sellSignal };
	}

	calculateSignalStrength(commonPoint, currentCandle) {
		let strength = commonPoint.confirmationCount * 10;
		strength += commonPoint.qualityScore * 0.5;

		if (currentCandle.volume > 0) {
			strength += 10;
		}

		return Math.min(strength, 100);
	}

	calculateConfidenceLevel(commonPoint, currentCandle) {
		let confidence = commonPoint.confirmationCount * 25;
		confidence += commonPoint.qualityScore * 0.3;

		if (currentCandle.volume > 0) {
			confidence += 10;
		}

		return Math.min(confidence, 100);
	}

	async saveSignalsToCSV(signals) {
		try {
			const records = signals.map(signal => ({
				timestamp: signal.timestamp,
				candleTimestamp: signal.candleTimestamp,
				signalType: signal.signalType,
				commonPointType: signal.commonPointType,
				commonPointPrice: signal.commonPointPrice.toFixed(6),
				currentPrice: signal.currentPrice.toFixed(6),
				strength: signal.strength,
				qualityScore: signal.qualityScore.toFixed(2),
				timeframes: signal.timeframes,
				volume: signal.volume.toFixed(2),
				barRange: signal.barRange.toFixed(6),
				signalStrength: signal.signalStrength.toFixed(2),
				confidence: signal.confidence.toFixed(2),
				buySignal: signal.buySignal,
				sellSignal: signal.sellSignal
			}));

			await this.csvWriter.writeRecords(records);
			logger.info(`💾 Saved ${records.length} signals to ${this.outputFile}`);
		} catch (error) {
			logger.error('Error saving signals to CSV:', error);
		}
	}

	getSignalsSummary() {
		const totalSignals = this.signals.length;
		const buySignals = this.signals.filter(s => s.buySignal).length;
		const sellSignals = this.signals.filter(s => s.sellSignal).length;

		return {
			totalSignals,
			buySignals,
			sellSignals
		};
	}
}

module.exports = { SignalService };

