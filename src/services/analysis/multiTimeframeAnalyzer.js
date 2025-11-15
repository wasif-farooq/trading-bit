const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../../config/config');
const logger = require('../../utils/logger');

class MultiTimeframeAnalyzer {
	constructor() {
		this.timeframes = new Map();
		this.commonSwingPoints = [];
	}

	addTimeframe(name, analyzer) {
		this.timeframes.set(name, analyzer);
	}

	findCommonSwingPoints() {
		const allSwingPoints = [];

		// Collect all swing points from all timeframes
		for (const [timeframe, analyzer] of this.timeframes) {
			if (typeof analyzer.getSwingPoints !== 'function') continue;
			const points = analyzer.getSwingPoints() || [];
			const swings = points.map(s => ({ ...s, timeframe }));
			allSwingPoints.push(...swings);
		}

		// Sort by timestamp
		allSwingPoints.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

		const commonPoints = [];
		const processed = new Set();

		// Find similar points across timeframes
		for (let i = 0; i < allSwingPoints.length; i++) {
			if (processed.has(i)) continue;

			const currentPoint = allSwingPoints[i];
			const similarPoints = [currentPoint];
			const timeframesFound = new Set([currentPoint.timeframe]);

			// Look for similar points
			for (let j = i + 1; j < allSwingPoints.length; j++) {
				if (processed.has(j)) continue;

				const otherPoint = allSwingPoints[j];

				if (this.arePointsSimilarEnhanced(currentPoint, otherPoint)) {
					similarPoints.push(otherPoint);
					timeframesFound.add(otherPoint.timeframe);
					processed.add(j);
				}
			}

			// Only create common point if found in 2+ timeframes
			if (timeframesFound.size > 1) {
				const commonPoint = this.createCommonPointEnhanced(similarPoints, timeframesFound);
				commonPoints.push(commonPoint);
			}

			processed.add(i);
		}

		this.commonSwingPoints = commonPoints;
		logger.info(`Found ${commonPoints.length} common swing points across ${this.timeframes.size} timeframes`);
		return commonPoints;
	}

	arePointsSimilarEnhanced(point1, point2) {
		if (point1.type !== point2.type) return false;
		if (!this.arePricesSimilar(point1, point2)) return false;

		const timeDiff = this.getTimeDifference(point1.timestamp, point2.timestamp);
		const maxTimeDiff = this.getMaxTimeDiffForTimeframes(point1.timeframe, point2.timeframe);
		if (timeDiff > maxTimeDiff) return false;

		if (!this.areOpenCloseSimilar(point1, point2)) return false;
		if (!this.areBarCharacteristicsSimilar(point1, point2)) return false;

		return true;
	}

	arePricesSimilar(point1, point2) {
		const mainPriceDiff = Math.abs(point1.price - point2.price) / point1.price;
		return mainPriceDiff <= CONFIG.commonPointTolerance;
	}

	areOpenCloseSimilar(point1, point2) {
		const bar1 = point1.bar;
		const bar2 = point2.bar;

		if (!bar1 || !bar2) return true; // If no bar data, skip this check

		const openDiff = Math.abs(bar1.open - bar2.open) / bar1.open;
		const closeDiff = Math.abs(bar1.close - bar2.close) / bar1.close;

		if (openDiff > CONFIG.openCloseTolerance) return false;
		if (closeDiff > CONFIG.openCloseTolerance) return false;

		const isBullish1 = bar1.close > bar1.open;
		const isBullish2 = bar2.close > bar2.open;

		if (isBullish1 !== isBullish2) {
			const bodySize1 = Math.abs(bar1.close - bar1.open);
			const bodySize2 = Math.abs(bar2.close - bar2.open);
			const avgBodySize = (bodySize1 + bodySize2) / 2;

			if (bodySize1 > avgBodySize * 0.3 && bodySize2 > avgBodySize * 0.3) {
				return false;
			}
		}

		return true;
	}

	areBarCharacteristicsSimilar(point1, point2) {
		const bar1 = point1.bar;
		const bar2 = point2.bar;

		if (!bar1 || !bar2) return true; // If no bar data, skip this check

		const range1 = bar1.high - bar1.low;
		const range2 = bar2.high - bar2.low;
		const rangeDiff = Math.abs(range1 - range2) / range1;

		if (rangeDiff > 0.5) return false;

		if (bar1.volume > 0 && bar2.volume > 0) {
			const volumeRatio = Math.min(bar1.volume, bar2.volume) / Math.max(bar1.volume, bar2.volume);
			if (volumeRatio < CONFIG.volumeSimilarityThreshold) return false;
		}

		return true;
	}

	getTimeDifference(timestamp1, timestamp2) {
		const date1 = new Date(timestamp1);
		const date2 = new Date(timestamp2);
		return Math.abs(date1 - date2) / (1000 * 60); // Return difference in minutes
	}

	getMaxTimeDiffForTimeframes(tf1, tf2) {
		const timeframeDurations = {
			'15s': 0.25,
			'1m': 1,
			'3m': 3,
			'5m': 5
		};

		const duration1 = timeframeDurations[tf1] || 1;
		const duration2 = timeframeDurations[tf2] || 1;

		return Math.max(duration1, duration2) * 2;
	}

	createCommonPointEnhanced(similarPoints, timeframesFound) {
		const types = similarPoints.map(p => p.type);
		const prices = similarPoints.map(p => p.price);
		const strengths = similarPoints.map(p => p.strength);
		const timestamps = similarPoints.map(p => p.timestamp);
		const opens = similarPoints.map(p => p.bar?.open || p.price);
		const closes = similarPoints.map(p => p.bar?.close || p.price);
		const highs = similarPoints.map(p => p.bar?.high || p.price);
		const lows = similarPoints.map(p => p.bar?.low || p.price);
		const volumes = similarPoints.map(p => p.bar?.volume || 0);
		const originalTimestamps = similarPoints.map(p => p.bar?.originalTimestamp || p.originalTimestamp || p.timestamp);

		// Determine dominant type
		const typeCount = types.reduce((acc, type) => {
			acc[type] = (acc[type] || 0) + 1;
			return acc;
		}, {});
		const dominantType = Object.keys(typeCount).reduce((a, b) =>
			typeCount[a] > typeCount[b] ? a : b
		);

		// Calculate quality score
		const qualityScore = this.calculateQualityScore(similarPoints);

		return {
			type: dominantType,
			price: this.calculateAveragePrice(prices),
			strength: this.calculateAverageStrength(strengths),
			timestamp: this.findMostCommonTimestamp(timestamps),
			originalTimestamp: this.findMostCommonTimestamp(originalTimestamps),
			timeframes: Array.from(timeframesFound),
			confirmationCount: timeframesFound.size,
			qualityScore: qualityScore,
			openPrice: this.calculateAveragePrice(opens),
			closePrice: this.calculateAveragePrice(closes),
			highPrice: this.calculateAveragePrice(highs),
			lowPrice: this.calculateAveragePrice(lows),
			volume: this.calculateAverageVolume(volumes),
			priceVariance: this.calculatePriceVariance(prices),
			openCloseVariance: this.calculatePriceVariance([...opens, ...closes]),
			allPoints: similarPoints
		};
	}

	calculateQualityScore(points) {
		let score = 0;
		score += points.length * 10; // Base score from confirmation count

		const prices = points.map(p => p.price);
		const priceVariance = this.calculatePriceVariance(prices);
		if (priceVariance < 0.0001) score += 20;
		else if (priceVariance < 0.0005) score += 10;

		const opens = points.map(p => p.bar?.open || p.price);
		const closes = points.map(p => p.bar?.close || p.price);
		const openVariance = this.calculatePriceVariance(opens);
		const closeVariance = this.calculatePriceVariance(closes);

		if (openVariance < 0.0001 && closeVariance < 0.0001) score += 15;

		const timeframes = new Set(points.map(p => p.timeframe));
		if (timeframes.size >= 3) score += 15;

		return score;
	}

	calculateAveragePrice(prices) {
		return prices.reduce((sum, price) => sum + price, 0) / prices.length;
	}

	calculateAverageStrength(strengths) {
		return strengths.reduce((sum, strength) => sum + strength, 0) / strengths.length;
	}

	calculateAverageVolume(volumes) {
		return volumes.reduce((sum, volume) => sum + volume, 0) / volumes.length;
	}

	calculatePriceVariance(prices) {
		const avg = this.calculateAveragePrice(prices);
		const variance = prices.reduce((sum, price) => sum + Math.pow(price - avg, 2), 0) / prices.length;
		return variance;
	}

	findMostCommonTimestamp(timestamps) {
		const timeGroups = timestamps.reduce((groups, timestamp) => {
			const date = new Date(timestamp);
			const key = new Date(date.getFullYear(), date.getMonth(), date.getDate(),
				date.getHours(), date.getMinutes()).getTime();
			if (!groups[key]) groups[key] = [];
			groups[key].push(timestamp);
			return groups;
		}, {});

		let maxCount = 0;
		let mostCommonTime = timestamps[0];

		Object.values(timeGroups).forEach(group => {
			if (group.length > maxCount) {
				maxCount = group.length;
				mostCommonTime = group[0];
			}
		});

		return mostCommonTime;
	}

	getPointKey(point) {
		const type = point.type || point.commonPointType || 'UNKNOWN';
		const price = typeof point.price === 'number' ? point.price : point.commonPointPrice;
		const roundedPrice = Math.round((price || 0) * 100000);
		return `${type}_${roundedPrice}`;
	}

	async exportCommonPointsToCSV(outputFile) {
		const commonPoints = this.findCommonSwingPoints();
		const header = [
			'TYPE',
			'TIMESTAMP',
			'ORIGINAL_15S_TIMESTAMP',
			'PRICE',
			'OPEN_PRICE',
			'CLOSE_PRICE',
			'HIGH_PRICE',
			'LOW_PRICE',
			'VOLUME',
			'STRENGTH',
			'QUALITY_SCORE',
			'CONFIRMATION_COUNT',
			'TIMEFRAMES',
			'PRICE_VARIANCE',
			'OPEN_CLOSE_VARIANCE'
		];

		const lines = [header.join(',')];
		commonPoints.forEach(point => {
			const line = [
				point.type || '',
				point.timestamp || '',
				point.originalTimestamp || '',
				typeof point.price === 'number' ? point.price.toFixed(6) : '',
				typeof point.openPrice === 'number' ? point.openPrice.toFixed(6) : '',
				typeof point.closePrice === 'number' ? point.closePrice.toFixed(6) : '',
				typeof point.highPrice === 'number' ? point.highPrice.toFixed(6) : '',
				typeof point.lowPrice === 'number' ? point.lowPrice.toFixed(6) : '',
				typeof point.volume === 'number' ? point.volume.toFixed(2) : '0.00',
				typeof point.strength === 'number' ? point.strength.toFixed(4) : '',
				typeof point.qualityScore === 'number' ? point.qualityScore.toFixed(2) : '',
				point.confirmationCount || 0,
				Array.isArray(point.timeframes) ? point.timeframes.join(',') : '',
				typeof point.priceVariance === 'number' ? point.priceVariance.toFixed(8) : '0.00000000',
				typeof point.openCloseVariance === 'number' ? point.openCloseVariance.toFixed(8) : '0.00000000'
			];
			lines.push(line.join(','));
		});

		await fs.promises.mkdir(path.dirname(outputFile), { recursive: true });
		await fs.promises.writeFile(outputFile, lines.join('\n'), 'utf8');
		logger.info(`Exported ${commonPoints.length} common swing points to ${outputFile}`);
	}
}

module.exports = { MultiTimeframeAnalyzer };
