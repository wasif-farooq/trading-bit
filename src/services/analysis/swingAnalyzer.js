const { CONFIG } = require('../../config/config');
const logger = require('../../utils/logger');

class SwingAnalyzer {
	constructor(timeframe) {
		this.timeframe = timeframe;
		this.priceData = [];
		this.swingPoints = [];
		this.swingHighs = [];
		this.swingLows = [];
		this.swingLeftBars = CONFIG.swingLeftBars || 5;
		this.swingRightBars = CONFIG.swingRightBars || 5;
		this.minSwingStrength = CONFIG.minSwingStrength || 0.1;
	}

	addPriceData(timestamp, open, high, low, close, volume, originalTimestamp) {
		this.priceData.push({
			timestamp,
			open: parseFloat(open),
			high: parseFloat(high),
			low: parseFloat(low),
			close: parseFloat(close),
			volume: parseFloat(volume),
			index: this.priceData.length,
			originalTimestamp: originalTimestamp || timestamp
		});
	}

	calculateSwingStrength(index, type) {
		const current = this.priceData[index];
		let totalMovement = 0;
		let count = 0;

		// Calculate average movement of surrounding bars (20 bars: index-10 to index+10)
		for (let i = Math.max(0, index - 10); i < Math.min(this.priceData.length, index + 10); i++) {
			if (i !== index && i > 0) {
				totalMovement += Math.abs(this.priceData[i].close - this.priceData[i - 1].close);
				count++;
			}
		}

		const avgMovement = totalMovement / count || 0.01;
		
		// Calculate swing movement
		const swingMovement = type === 'high' ?
			current.high - Math.min(current.low, this.priceData[index - 1]?.low || current.low) :
			Math.max(current.high, this.priceData[index - 1]?.high || current.high) - current.low;

		return swingMovement / avgMovement;
	}

	detectSwingPoints() {
		this.swingHighs = [];
		this.swingLows = [];
		this.swingPoints = [];

		if (this.priceData.length < this.swingLeftBars + this.swingRightBars + 1) {
			logger.info(`[${this.timeframe}] Not enough data for swing detection: ${this.priceData.length} bars (need ${this.swingLeftBars + this.swingRightBars + 1})`);
			return;
		}

		logger.info(`[${this.timeframe}] Detecting swing points from ${this.priceData.length} bars (left: ${this.swingLeftBars}, right: ${this.swingRightBars}, minStrength: ${this.minSwingStrength})`);

		// Detect swing highs and lows
		for (let i = this.swingLeftBars; i < this.priceData.length - this.swingRightBars; i++) {
			const current = this.priceData[i];
			let isSwingHigh = true;
			let isSwingLow = true;

			// Check left bars
			for (let j = 1; j <= this.swingLeftBars; j++) {
				if (current.high <= this.priceData[i - j].high) isSwingHigh = false;
				if (current.low >= this.priceData[i - j].low) isSwingLow = false;
			}

			// Check right bars
			for (let j = 1; j <= this.swingRightBars; j++) {
				if (current.high <= this.priceData[i + j].high) isSwingHigh = false;
				if (current.low >= this.priceData[i + j].low) isSwingLow = false;
			}

			if (isSwingHigh) {
				const strength = this.calculateSwingStrength(i, 'high');
				if (strength >= this.minSwingStrength) {
					this.swingHighs.push({
						timestamp: current.timestamp,
						price: current.high,
						type: 'SWING_HIGH',
						strength: strength,
						index: i,
						timeframe: this.timeframe,
						bar: {
							open: current.open,
							high: current.high,
							low: current.low,
							close: current.close,
							volume: current.volume,
							originalTimestamp: current.originalTimestamp
						},
						barRange: current.high - current.low,
						bodySize: Math.abs(current.close - current.open),
						isBullish: current.close > current.open
					});
				}
			}

			if (isSwingLow) {
				const strength = this.calculateSwingStrength(i, 'low');
				if (strength >= this.minSwingStrength) {
					this.swingLows.push({
						timestamp: current.timestamp,
						price: current.low,
						type: 'SWING_LOW',
						strength: strength,
						index: i,
						timeframe: this.timeframe,
						bar: {
							open: current.open,
							high: current.high,
							low: current.low,
							close: current.close,
							volume: current.volume,
							originalTimestamp: current.originalTimestamp
						},
						barRange: current.high - current.low,
						bodySize: Math.abs(current.close - current.open),
						isBullish: current.close > current.open
					});
				}
			}
		}

		// Filter consecutive swings
		this.filterConsecutiveSwings();

		// Combine swing highs and lows into swingPoints array
		this.swingPoints = [...this.swingHighs, ...this.swingLows];

		logger.info(`[${this.timeframe}] Found ${this.swingHighs.length} swing highs and ${this.swingLows.length} swing lows`);
		logger.info(`[${this.timeframe}] Swing detection complete: found ${this.swingPoints.length} swing points`);
	}

	filterConsecutiveSwings() {
		this.swingHighs = this.swingHighs.filter((swing, index, array) => {
			if (index === 0) return true;
			const prevSwing = array[index - 1];
			return swing.index - prevSwing.index > this.swingLeftBars;
		});

		this.swingLows = this.swingLows.filter((swing, index, array) => {
			if (index === 0) return true;
			const prevSwing = array[index - 1];
			return swing.index - prevSwing.index > this.swingLeftBars;
		});
	}

	getSwingPoints() {
		return this.swingPoints;
	}

	getAnalysisResults() {
		return {
			summary: {
				timeframe: this.timeframe,
				totalSwingPoints: this.swingHighs.length + this.swingLows.length,
				totalSwingHighs: this.swingHighs.length,
				totalSwingLows: this.swingLows.length,
				dataPoints: this.priceData.length
			},
			swingHighs: this.swingHighs,
			swingLows: this.swingLows
		};
	}
}

module.exports = { SwingAnalyzer };

