const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

// ==================== CẤU HÌNH API ====================
const API_LC_HU = "https://wtx.tele68.com/v1/tx/lite-sessions?cp=R&cl=R&pf=web&at=83991213bfd4c554dc94bcd98979bdc5";
const API_MD5 = "https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8";
const USER_ID = "@tranhoang2286";

// ==================== FILE LƯU TRỮ ====================
const FILES = {
    HISTORY: './history.json',
    PATTERNS: './patterns.json',
    WEIGHTS: './weights.json',
    STATS: './stats.json',
    LEARNING: './learning_data.json',
    MODEL: './model_state.json',
    SIGNALS: './signals.json',
    CACHE: './cache.json'
};

// ==================== BIẾN TOÀN CỤC ====================
let state = {
    history: [],
    patterns: {},
    weights: {},
    stats: { total: 0, correct: 0, wrong: 0, streak: 0, maxStreak: 0, totalWin: 0, totalLoss: 0 },
    learningData: {},
    modelState: {},
    signals: {},
    cache: {}
};

// ==================== LOAD/SAVE DỮ LIỆU ====================
function loadAllData() {
    try {
        for (const [key, file] of Object.entries(FILES)) {
            if (fs.existsSync(file)) {
                const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                const stateKey = key.toLowerCase();
                if (stateKey === 'history') state.history = data;
                else if (stateKey === 'patterns') state.patterns = data;
                else if (stateKey === 'weights') state.weights = data;
                else if (stateKey === 'stats') state.stats = data;
                else if (stateKey === 'learning') state.learningData = data;
                else if (stateKey === 'model') state.modelState = data;
                else if (stateKey === 'signals') state.signals = data;
                else if (stateKey === 'cache') state.cache = data;
                console.log(`[📂] Đã tải ${file}: ${Array.isArray(data) ? data.length : Object.keys(data).length} items`);
            }
        }
    } catch (e) {
        console.error('[❌] Lỗi load dữ liệu:', e.message);
    }
}

function saveAllData() {
    try {
        for (const [key, file] of Object.entries(FILES)) {
            const stateKey = key.toLowerCase();
            fs.writeFileSync(file, JSON.stringify(state[stateKey] || {}, null, 2));
        }
    } catch (e) {
        console.error('[❌] Lỗi save dữ liệu:', e.message);
    }
}

// ==================== THUẬT TOÁN PHÂN TÍCH CẤP CAO ====================

// 1. Phân tích ma trận chuyển tiếp Markov đa cấp
function analyzeMarkovMatrix(history) {
    if (history.length < 10) return null;
    
    const results = history.map(h => h.result);
    const orders = [1, 2, 3, 4, 5];
    let allTransitions = {};
    let predictions = [];
    
    for (const order of orders) {
        if (results.length < order + 1) continue;
        
        const transitions = {};
        for (let i = 0; i <= results.length - order - 1; i++) {
            const state = results.slice(i, i + order).join('');
            const next = results[i + order];
            if (!transitions[state]) transitions[state] = { T: 0, X: 0 };
            transitions[state][next]++;
        }
        
        const lastState = results.slice(-order).join('');
        if (transitions[lastState]) {
            const data = transitions[lastState];
            const total = data.T + data.X;
            const taiProb = data.T / total;
            const xiuProb = data.X / total;
            const confidence = Math.abs(taiProb - xiuProb);
            
            predictions.push({
                order: order,
                prediction: taiProb > xiuProb ? 'T' : 'X',
                confidence: 50 + confidence * 45,
                taiProb: taiProb,
                xiuProb: xiuProb,
                total: total
            });
        }
        
        allTransitions[order] = transitions;
    }
    
    if (predictions.length === 0) return null;
    
    // Trọng số theo bậc
    let tScore = 0, xScore = 0;
    let totalWeight = 0;
    
    for (const pred of predictions) {
        const weight = pred.order / 5 * (pred.confidence / 100);
        if (pred.prediction === 'T') tScore += weight;
        else xScore += weight;
        totalWeight += weight;
    }
    
    const finalPred = tScore > xScore ? 'T' : 'X';
    const confidence = Math.round((Math.max(tScore, xScore) / totalWeight) * 100);
    const bestPred = predictions.reduce((a, b) => a.confidence > b.confidence ? a : b);
    
    return {
        prediction: finalPred,
        confidence: Math.min(90, Math.max(50, confidence)),
        bestOrder: bestPred.order,
        bestConfidence: bestPred.confidence,
        details: predictions,
        reason: `Markov bậc ${bestPred.order} (${bestPred.confidence}%)`
    };
}

// 2. Phân tích cầu Fibonacci kết hợp
function analyzeAdvancedFibonacci(history) {
    if (history.length < 30) return null;
    
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    const fibs = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55];
    let fibData = {};
    let totalMatches = 0;
    let weightedScore = 0;
    
    for (const f of fibs) {
        if (history.length > f) {
            const match = results[results.length - f] === results[results.length - 1];
            const weight = 1 / Math.sqrt(f);
            fibData[f] = { match, weight };
            if (match) {
                totalMatches++;
                weightedScore += weight;
            }
        }
    }
    
    const totalWeight = Object.values(fibData).reduce((sum, d) => sum + d.weight, 0);
    const strength = totalWeight > 0 ? weightedScore / totalWeight : 0;
    const matchRatio = totalMatches / Object.keys(fibData).length;
    
    // Phân tích các vị trí Fibonacci
    let fibPositions = [];
    for (const f of fibs) {
        if (history.length > f) {
            fibPositions.push({
                position: f,
                value: results[results.length - f],
                current: results[results.length - 1]
            });
        }
    }
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (strength > 0.7 || matchRatio > 0.6) {
        prediction = results[results.length - 1] === 1 ? 'X' : 'T';
        confidence = Math.min(88, 60 + strength * 35);
        reason = `Fibonacci mạnh (${(strength*100).toFixed(0)}%)`;
    } else if (strength > 0.5) {
        prediction = results[results.length - 1] === 1 ? 'X' : 'T';
        confidence = Math.min(80, 55 + strength * 30);
        reason = `Fibonacci (${(strength*100).toFixed(0)}%)`;
    } else {
        // Phân tích xu hướng Fibonacci
        const fibTrend = fibPositions.filter(p => p.value === 1).length / fibPositions.length;
        if (fibTrend > 0.6) {
            prediction = 'X';
            confidence = 55;
            reason = `Xu hướng Fibonacci Tài (${(fibTrend*100).toFixed(0)}%)`;
        } else if (fibTrend < 0.4) {
            prediction = 'T';
            confidence = 55;
            reason = `Xu hướng Fibonacci Xỉu (${((1-fibTrend)*100).toFixed(0)}%)`;
        } else {
            prediction = results[results.length - 1] === 1 ? 'T' : 'X';
            confidence = 50;
            reason = `Fibonacci trung tính`;
        }
    }
    
    return {
        prediction,
        confidence: Math.min(88, Math.max(50, confidence)),
        reason,
        strength,
        matchRatio,
        totalMatches,
        fibPositions,
        weightedScore,
        totalWeight
    };
}

// 3. Phân tích cầu Pivot (Điểm xoay)
function analyzePivot(history) {
    if (history.length < 10) return null;
    
    const results = history.map(h => h.result);
    const scores = history.map(h => h.score || 0);
    
    // Tìm điểm pivot trong 10 phiên gần nhất
    let pivots = [];
    for (let i = 2; i < results.length - 2; i++) {
        const prev = results[i-1];
        const curr = results[i];
        const next = results[i+1];
        
        if (curr !== prev && curr !== next) {
            pivots.push({
                position: i,
                value: curr,
                type: 'reversal'
            });
        }
    }
    
    // Phân tích khoảng cách pivot
    let pivotDistances = [];
    for (let i = 1; i < pivots.length; i++) {
        pivotDistances.push(pivots[i].position - pivots[i-1].position);
    }
    const avgDistance = pivotDistances.length ? pivotDistances.reduce((a,b) => a+b, 0) / pivotDistances.length : 0;
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    const lastResult = results[results.length - 1];
    const otherResult = lastResult === 'T' ? 'X' : 'T';
    
    if (pivots.length >= 3) {
        const lastPivot = pivots[pivots.length - 1];
        const distance = results.length - 1 - lastPivot.position;
        
        if (distance >= avgDistance * 1.5) {
            prediction = otherResult;
            confidence = Math.min(80, 60 + (distance / avgDistance) * 10);
            reason = `Đến điểm pivot (cách ${distance} phiên)`;
        } else if (distance >= avgDistance * 1.2) {
            prediction = otherResult;
            confidence = 65;
            reason = `Gần điểm pivot (cách ${distance} phiên)`;
        } else {
            prediction = lastResult;
            confidence = 55;
            reason = `Chưa đến điểm pivot`;
        }
    } else {
        prediction = lastResult;
        confidence = 50;
        reason = `Không đủ pivot (${pivots.length})`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        pivots,
        avgDistance,
        totalPivots: pivots.length,
        lastPivot: pivots.length ? pivots[pivots.length - 1] : null
    };
}

// 4. Phân tích cầu Harmonic (hài hòa)
function analyzeHarmonic(history) {
    if (history.length < 15) return null;
    
    const results = history.map(h => h.result);
    const ratios = [0.382, 0.5, 0.618, 0.786, 1.0, 1.272, 1.618];
    
    // Tìm các mẫu harmonic
    let harmonicPatterns = [];
    for (let i = 0; i < results.length - 5; i++) {
        const segment = results.slice(i, i + 5);
        const pattern = segment.join('');
        
        // Kiểm tra các mẫu harmonic
        if (pattern === 'TXTXT' || pattern === 'XTXTX') {
            harmonicPatterns.push({
                position: i,
                pattern: pattern,
                type: 'alternating',
                confidence: 70
            });
        }
        if (pattern === 'TTXTT' || pattern === 'XXTXX') {
            harmonicPatterns.push({
                position: i,
                pattern: pattern,
                type: '2-1-2',
                confidence: 72
            });
        }
        if (pattern === 'TXXTX' || pattern === 'XTTXT') {
            harmonicPatterns.push({
                position: i,
                pattern: pattern,
                type: '1-2-1',
                confidence: 72
            });
        }
    }
    
    // Lọc các mẫu harmonic gần đây
    const recentHarmonics = harmonicPatterns.filter(p => p.position >= results.length - 20);
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (recentHarmonics.length >= 2) {
        const lastHarmonic = recentHarmonics[recentHarmonics.length - 1];
        const distance = results.length - lastHarmonic.position - 5;
        
        // Dự đoán dựa trên mẫu harmonic
        if (distance <= 3) {
            const lastResult = results[results.length - 1];
            prediction = lastResult === 'T' ? 'X' : 'T';
            confidence = 72;
            reason = `Mẫu harmonic ${lastHarmonic.type} gần đây`;
        } else {
            prediction = results[results.length - 1];
            confidence = 55;
            reason = `Chờ tín hiệu harmonic`;
        }
    } else if (harmonics.length >= 1) {
        const lastHarmonic = harmonics[harmonics.length - 1];
        const distance = results.length - lastHarmonic.position - 5;
        
        if (distance <= 2) {
            const lastResult = results[results.length - 1];
            prediction = lastResult === 'T' ? 'X' : 'T';
            confidence = 65;
            reason = `Mẫu harmonic ${lastHarmonic.type} vừa xuất hiện`;
        } else {
            prediction = results[results.length - 1];
            confidence = 52;
            reason = `Mẫu harmonic cũ (cách ${distance} phiên)`;
        }
    } else {
        prediction = results[results.length - 1];
        confidence = 50;
        reason = `Không có mẫu harmonic`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        harmonics: harmonicPatterns,
        recentHarmonics,
        totalHarmonics: harmonicPatterns.length
    };
}

// 5. Phân tích cầu Elliot Wave
function analyzeElliotWave(history) {
    if (history.length < 20) return null;
    
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    let waves = [];
    let currentWave = [];
    let direction = null;
    
    // Phân tích sóng
    for (let i = 0; i < results.length; i++) {
        if (currentWave.length === 0) {
            currentWave.push(results[i]);
            direction = null;
        } else if (direction === null) {
            if (results[i] !== currentWave[currentWave.length - 1]) {
                direction = results[i] > currentWave[currentWave.length - 1] ? 'up' : 'down';
                currentWave.push(results[i]);
            } else {
                currentWave.push(results[i]);
            }
        } else {
            const last = currentWave[currentWave.length - 1];
            if (direction === 'up' && results[i] >= last) {
                currentWave.push(results[i]);
            } else if (direction === 'down' && results[i] <= last) {
                currentWave.push(results[i]);
            } else {
                waves.push({
                    values: [...currentWave],
                    direction: direction,
                    length: currentWave.length,
                    start: i - currentWave.length,
                    end: i - 1
                });
                currentWave = [results[i]];
                direction = null;
                i--;
            }
        }
    }
    
    if (currentWave.length > 0) {
        waves.push({
            values: [...currentWave],
            direction: direction,
            length: currentWave.length,
            start: results.length - currentWave.length,
            end: results.length - 1
        });
    }
    
    // Phân tích sóng Elliot
    let wavePattern = [];
    for (let i = 0; i < waves.length; i++) {
        wavePattern.push(waves[i].direction);
    }
    
    // Dự đoán dựa trên sóng
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (waves.length >= 5) {
        const last3Waves = waves.slice(-3);
        const directions = last3Waves.map(w => w.direction);
        const lengths = last3Waves.map(w => w.length);
        
        // Kiểm tra mẫu 5 sóng (Elliot)
        if (directions[0] === directions[2] && directions[0] !== directions[1]) {
            // Sóng điều chỉnh
            const lastResult = results[results.length - 1];
            const pred = lastResult === 1 ? 'X' : 'T';
            confidence = 70;
            reason = `Sóng Elliot điều chỉnh (${waves.length} sóng)`;
            prediction = pred;
        } else {
            // Sóng tiếp theo
            const lastWave = waves[waves.length - 1];
            const pred = lastWave.direction === 'up' ? 'X' : 'T';
            confidence = 65;
            reason = `Sóng Elliot ${lastWave.direction === 'up' ? 'tăng' : 'giảm'} (${waves.length} sóng)`;
            prediction = pred;
        }
    } else if (waves.length >= 3) {
        const lastWave = waves[waves.length - 1];
        const pred = lastWave.direction === 'up' ? 'X' : 'T';
        confidence = 60;
        reason = `Sóng Elliot cơ bản (${waves.length} sóng)`;
        prediction = pred;
    } else {
        prediction = results[results.length - 1] === 1 ? 'T' : 'X';
        confidence = 50;
        reason = `Chưa đủ sóng Elliot (${waves.length})`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        waves,
        waveCount: waves.length,
        wavePattern,
        lastWave: waves.length ? waves[waves.length - 1] : null
    };
}

// 6. Phân tích cầu Gann (Góc độ)
function analyzeGann(history) {
    if (history.length < 15) return null;
    
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    const angles = [45, 60, 90, 120, 180, 240, 270, 300, 360];
    let angleData = {};
    
    for (const angle of angles) {
        const step = Math.round(360 / angle);
        if (step < 2) continue;
        
        let matches = 0;
        let total = 0;
        for (let i = step; i < results.length; i += step) {
            if (results[i] === results[i - step]) {
                matches++;
            }
            total++;
        }
        angleData[angle] = {
            strength: total > 0 ? matches / total : 0,
            matches: matches,
            total: total,
            step: step
        };
    }
    
    // Tìm góc mạnh nhất
    let bestAngle = 45;
    let bestStrength = 0;
    for (const angle of angles) {
        if (angleData[angle] && angleData[angle].strength > bestStrength) {
            bestStrength = angleData[angle].strength;
            bestAngle = angle;
        }
    }
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (bestStrength > 0.6) {
        const step = angleData[bestAngle].step;
        const lastIndex = results.length - 1;
        const prevIndex = lastIndex - step;
        
        if (prevIndex >= 0) {
            const prevResult = results[prevIndex];
            prediction = prevResult === 1 ? 'T' : 'X';
            confidence = Math.min(82, 55 + bestStrength * 35);
            reason = `Góc Gann ${bestAngle}° (${(bestStrength*100).toFixed(0)}%)`;
        } else {
            prediction = results[results.length - 1] === 1 ? 'T' : 'X';
            confidence = 55;
            reason = `Góc Gann ${bestAngle}° (thiếu dữ liệu)`;
        }
    } else {
        prediction = results[results.length - 1] === 1 ? 'T' : 'X';
        confidence = 50;
        reason = `Không có góc Gann mạnh`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        bestAngle,
        bestStrength,
        angleData
    };
}

// 7. Phân tích cầu Wolfe Wave
function analyzeWolfeWave(history) {
    if (history.length < 20) return null;
    
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    let peaks = [];
    let troughs = [];
    
    // Tìm đỉnh và đáy
    for (let i = 2; i < results.length - 2; i++) {
        if (results[i] > results[i-1] && results[i] > results[i+1] &&
            results[i] > results[i-2] && results[i] > results[i+2]) {
            peaks.push({ position: i, value: results[i] });
        }
        if (results[i] < results[i-1] && results[i] < results[i+1] &&
            results[i] < results[i-2] && results[i] < results[i+2]) {
            troughs.push({ position: i, value: results[i] });
        }
    }
    
    // Kết hợp peaks và troughs
    let extremums = [];
    for (const p of peaks) extremums.push({ position: p.position, value: p.value, type: 'peak' });
    for (const t of troughs) extremums.push({ position: t.position, value: t.value, type: 'trough' });
    extremums.sort((a, b) => a.position - b.position);
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (extremums.length >= 5) {
        const last5 = extremums.slice(-5);
        const pattern = last5.map(e => e.type);
        
        // Kiểm tra mẫu Wolfe Wave
        if (pattern[0] === pattern[2] && pattern[2] === pattern[4] &&
            pattern[0] !== pattern[1] && pattern[1] === pattern[3]) {
            const lastResult = results[results.length - 1];
            const pred = lastResult === 1 ? 'X' : 'T';
            confidence = 75;
            reason = `Phát hiện Wolfe Wave (${extremums.length} điểm)`;
            prediction = pred;
        } else {
            const lastExtremum = extremums[extremums.length - 1];
            const dist = results.length - 1 - lastExtremum.position;
            
            if (dist >= 3) {
                const pred = lastExtremum.type === 'peak' ? 'X' : 'T';
                confidence = 65;
                reason = `Wolfe Wave gần đây (${lastExtremum.type})`;
                prediction = pred;
            } else {
                prediction = results[results.length - 1] === 1 ? 'T' : 'X';
                confidence = 55;
                reason = `Wolfe Wave đang hình thành`;
            }
        }
    } else {
        prediction = results[results.length - 1] === 1 ? 'T' : 'X';
        confidence = 50;
        reason = `Chưa đủ điểm cho Wolfe Wave (${extremums.length})`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        extremums,
        totalExtremums: extremums.length,
        lastExtremum: extremums.length ? extremums[extremums.length - 1] : null
    };
}

// 8. Phân tích cầu Fibonacci Retracement
function analyzeFibRetracement(history) {
    if (history.length < 20) return null;
    
    const scores = history.map(h => h.score || 0);
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    
    // Tìm đỉnh và đáy điểm số
    let highPoints = [];
    let lowPoints = [];
    
    for (let i = 5; i < scores.length - 5; i++) {
        const window = scores.slice(i - 5, i + 6);
        if (scores[i] === Math.max(...window)) {
            highPoints.push({ position: i, value: scores[i] });
        }
        if (scores[i] === Math.min(...window)) {
            lowPoints.push({ position: i, value: scores[i] });
        }
    }
    
    if (highPoints.length < 2 || lowPoints.length < 2) return null;
    
    const lastHigh = highPoints[highPoints.length - 1];
    const lastLow = lowPoints[lowPoints.length - 1];
    const currentScore = scores[scores.length - 1];
    
    // Tính Fibonacci retracement
    const range = lastHigh.value - lastLow.value;
    const levels = {
        '0%': lastLow.value,
        '23.6%': lastLow.value + range * 0.236,
        '38.2%': lastLow.value + range * 0.382,
        '50%': lastLow.value + range * 0.5,
        '61.8%': lastLow.value + range * 0.618,
        '78.6%': lastLow.value + range * 0.786,
        '100%': lastHigh.value
    };
    
    // Xác định vị trí hiện tại
    let currentLevel = '50%';
    let minDiff = Infinity;
    for (const [level, value] of Object.entries(levels)) {
        const diff = Math.abs(currentScore - value);
        if (diff < minDiff) {
            minDiff = diff;
            currentLevel = level;
        }
    }
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    const levelNum = parseFloat(currentLevel);
    if (levelNum < 38.2) {
        prediction = 'X';
        confidence = 65;
        reason = `Fibonacci tại ${currentLevel} (vùng kháng cự)`;
    } else if (levelNum > 61.8) {
        prediction = 'T';
        confidence = 65;
        reason = `Fibonacci tại ${currentLevel} (vùng hỗ trợ)`;
    } else {
        prediction = currentScore > 11 ? 'X' : 'T';
        confidence = 55;
        reason = `Fibonacci tại ${currentLevel} (vùng trung tính)`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        levels,
        currentLevel,
        lastHigh,
        lastLow,
        currentScore
    };
}

// 9. Phân tích cầu Kagi
function analyzeKagi(history) {
    if (history.length < 10) return null;
    
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    const scores = history.map(h => h.score || 0);
    
    // Xây dựng biểu đồ Kagi
    let kagi = [];
    let currentLine = [];
    let direction = null;
    const threshold = 2; // Ngưỡng thay đổi
    
    for (let i = 0; i < scores.length; i++) {
        if (currentLine.length === 0) {
            currentLine.push(scores[i]);
        } else {
            const last = currentLine[currentLine.length - 1];
            const diff = scores[i] - last;
            
            if (direction === null) {
                if (Math.abs(diff) >= threshold) {
                    direction = diff > 0 ? 'up' : 'down';
                    currentLine.push(scores[i]);
                }
            } else if (direction === 'up' && diff < 0 && Math.abs(diff) >= threshold) {
                kagi.push({ values: [...currentLine], direction: 'up' });
                currentLine = [last, scores[i]];
                direction = 'down';
            } else if (direction === 'down' && diff > 0 && diff >= threshold) {
                kagi.push({ values: [...currentLine], direction: 'down' });
                currentLine = [last, scores[i]];
                direction = 'up';
            } else {
                currentLine.push(scores[i]);
            }
        }
    }
    
    if (currentLine.length > 0) {
        kagi.push({ values: [...currentLine], direction: direction });
    }
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (kagi.length >= 3) {
        const lastKagi = kagi[kagi.length - 1];
        const prevKagi = kagi[kagi.length - 2];
        
        if (lastKagi.direction !== prevKagi.direction) {
            // Đảo chiều
            const lastResult = results[results.length - 1];
            prediction = lastResult === 1 ? 'X' : 'T';
            confidence = 70;
            reason = `Kagi đảo chiều (${lastKagi.direction})`;
        } else {
            // Tiếp tục
            const pred = lastKagi.direction === 'up' ? 'T' : 'X';
            prediction = pred;
            confidence = 65;
            reason = `Kagi tiếp tục (${lastKagi.direction})`;
        }
    } else {
        prediction = results[results.length - 1] === 1 ? 'T' : 'X';
        confidence = 50;
        reason = `Chưa đủ Kagi (${kagi.length})`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        kagi,
        totalKagi: kagi.length,
        lastKagi: kagi.length ? kagi[kagi.length - 1] : null
    };
}

// 10. Phân tích cầu Renko
function analyzeRenko(history) {
    if (history.length < 10) return null;
    
    const scores = history.map(h => h.score || 0);
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    
    // Xây dựng biểu đồ Renko
    let renko = [];
    let currentBrick = null;
    const brickSize = 2;
    
    for (let i = 0; i < scores.length; i++) {
        if (currentBrick === null) {
            currentBrick = { value: scores[i], count: 1 };
        } else {
            const diff = scores[i] - currentBrick.value;
            if (Math.abs(diff) >= brickSize) {
                const direction = diff > 0 ? 'up' : 'down';
                const count = Math.floor(Math.abs(diff) / brickSize);
                renko.push({
                    value: currentBrick.value,
                    count: currentBrick.count,
                    direction: direction
                });
                currentBrick = {
                    value: scores[i],
                    count: 1
                };
            } else {
                currentBrick.count++;
            }
        }
    }
    
    if (currentBrick !== null) {
        renko.push({
            value: currentBrick.value,
            count: currentBrick.count,
            direction: null
        });
    }
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (renko.length >= 4) {
        const last3 = renko.slice(-3);
        const directions = last3.map(b => b.direction).filter(d => d !== null);
        
        if (directions.length >= 2) {
            if (directions[0] === directions[1]) {
                // Xu hướng
                const pred = directions[0] === 'up' ? 'T' : 'X';
                prediction = pred;
                confidence = 70;
                reason = `Renko xu hướng ${directions[0] === 'up' ? 'tăng' : 'giảm'}`;
            } else {
                // Đảo chiều
                const lastResult = results[results.length - 1];
                prediction = lastResult === 1 ? 'X' : 'T';
                confidence = 65;
                reason = `Renko đảo chiều`;
            }
        } else {
            prediction = results[results.length - 1] === 1 ? 'T' : 'X';
            confidence = 55;
            reason = `Renko trung tính`;
        }
    } else {
        prediction = results[results.length - 1] === 1 ? 'T' : 'X';
        confidence = 50;
        reason = `Chưa đủ Renko (${renko.length})`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        renko,
        totalRenko: renko.length,
        lastBrick: renko.length ? renko[renko.length - 1] : null
    };
}

// 11. Phân tích cầu Ichimoku
function analyzeIchimoku(history) {
    if (history.length < 26) return null;
    
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    const scores = history.map(h => h.score || 0);
    
    // Tính các đường Ichimoku
    const tenkan = (period) => {
        if (scores.length < period) return 0;
        const recent = scores.slice(-period);
        return (Math.max(...recent) + Math.min(...recent)) / 2;
    };
    
    const tenkanSen = tenkan(9);
    const kijunSen = tenkan(26);
    const senkouSpanA = (tenkanSen + kijunSen) / 2;
    
    // Phân tích
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    const currentScore = scores[scores.length - 1];
    const lastResult = results[results.length - 1];
    
    if (currentScore > senkouSpanA && currentScore > kijunSen) {
        prediction = 'T';
        confidence = 72;
        reason = 'Ichimoku: Giá trên Kijun và Senkou';
    } else if (currentScore < senkouSpanA && currentScore < kijunSen) {
        prediction = 'X';
        confidence = 72;
        reason = 'Ichimoku: Giá dưới Kijun và Senkou';
    } else if (currentScore > kijunSen) {
        prediction = 'T';
        confidence = 65;
        reason = 'Ichimoku: Giá trên Kijun';
    } else if (currentScore < kijunSen) {
        prediction = 'X';
        confidence = 65;
        reason = 'Ichimoku: Giá dưới Kijun';
    } else {
        prediction = lastResult === 1 ? 'T' : 'X';
        confidence = 55;
        reason = 'Ichimoku: Trung tính';
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        tenkanSen,
        kijunSen,
        senkouSpanA,
        currentScore
    };
}

// 12. Phân tích cầu Đa thời gian (Multi-Timeframe)
function analyzeMultiTimeframe(history) {
    if (history.length < 30) return null;
    
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    const timeframes = [5, 10, 20, 30];
    let timeframeData = {};
    let predictions = [];
    
    for (const tf of timeframes) {
        if (history.length < tf) continue;
        
        const recent = results.slice(-tf);
        const taiCount = recent.filter(r => r === 1).length;
        const ratio = taiCount / tf;
        const imbalance = Math.abs(ratio - 0.5);
        
        timeframeData[tf] = {
            ratio: ratio,
            taiCount: taiCount,
            xiuCount: tf - taiCount,
            imbalance: imbalance,
            trend: ratio > 0.5 ? 'T' : 'X',
            strength: imbalance * 2
        };
        
        if (imbalance > 0.2) {
            predictions.push({
                tf: tf,
                prediction: ratio > 0.5 ? 'T' : 'X',
                confidence: 50 + imbalance * 40,
                strength: imbalance
            });
        }
    }
    
    if (predictions.length === 0) {
        return {
            prediction: results[results.length - 1] === 1 ? 'T' : 'X',
            confidence: 50,
            reason: 'Không có tín hiệu đa thời gian',
            timeframeData
        };
    }
    
    // Trọng số theo khung thời gian
    let tScore = 0, xScore = 0;
    let totalWeight = 0;
    
    for (const pred of predictions) {
        const weight = (pred.tf / 30) * pred.confidence / 100;
        if (pred.prediction === 'T') tScore += weight;
        else xScore += weight;
        totalWeight += weight;
    }
    
    const finalPred = tScore > xScore ? 'T' : 'X';
    const confidence = Math.round((Math.max(tScore, xScore) / totalWeight) * 100);
    const bestPred = predictions.reduce((a, b) => a.confidence > b.confidence ? a : b);
    
    return {
        prediction: finalPred,
        confidence: Math.min(88, Math.max(50, confidence)),
        bestTF: bestPred.tf,
        bestConfidence: bestPred.confidence,
        details: predictions,
        timeframeData,
        reason: `Đa thời gian TF${bestPred.tf} (${bestPred.confidence}%)`
    };
}

// 13. Phân tích cầu Neural Pattern
function analyzeNeuralPattern(history) {
    if (history.length < 20) return null;
    
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    const scores = history.map(h => h.score || 0);
    
    // Tìm các pattern phức tạp
    let complexPatterns = [];
    for (let len = 3; len <= 7; len++) {
        for (let i = 0; i <= results.length - len - 1; i++) {
            const pattern = results.slice(i, i + len).join('');
            const next = results[i + len];
            complexPatterns.push({
                pattern: pattern,
                len: len,
                next: next,
                position: i
            });
        }
    }
    
    // Tìm pattern khớp với vị trí hiện tại
    const lastPatterns = [];
    for (let len = 3; len <= 7; len++) {
        if (results.length >= len) {
            const currentPattern = results.slice(-len).join('');
            lastPatterns.push({
                pattern: currentPattern,
                len: len,
                position: results.length - len
            });
        }
    }
    
    let matches = [];
    for (const lp of lastPatterns) {
        for (const cp of complexPatterns) {
            if (cp.pattern === lp.pattern && cp.position !== lp.position) {
                matches.push({
                    len: lp.len,
                    pattern: lp.pattern,
                    next: cp.next,
                    confidence: 70 + (lp.len / 7) * 20
                });
            }
        }
    }
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (matches.length > 0) {
        // Trọng số theo độ dài
        let tScore = 0, xScore = 0;
        for (const m of matches) {
            const weight = m.len / 7;
            if (m.next === 1) tScore += weight;
            else xScore += weight;
        }
        
        if (tScore > xScore) {
            prediction = 'T';
            confidence = Math.min(80, 60 + (tScore - xScore) * 20);
        } else {
            prediction = 'X';
            confidence = Math.min(80, 60 + (xScore - tScore) * 20);
        }
        reason = `Neural pattern (${matches.length} khớp)`;
    } else {
        prediction = results[results.length - 1] === 1 ? 'T' : 'X';
        confidence = 50;
        reason = 'Không có pattern khớp';
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        matches,
        totalMatches: matches.length,
        complexPatterns: complexPatterns.slice(0, 10)
    };
}

// 14. Phân tích cầu Machine Learning Ensemble
function analyzeMLEnsemble(history) {
    if (history.length < 30) return null;
    
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    const scores = history.map(h => h.score || 0);
    
    // Feature extraction
    let features = [];
    for (let i = 10; i < results.length; i++) {
        const window = results.slice(i - 10, i);
        const scoreWindow = scores.slice(i - 10, i);
        const feature = {
            result: results[i],
            score: scores[i],
            avgScore: scoreWindow.reduce((a,b) => a+b, 0) / 10,
            taiCount: window.filter(r => r === 1).length,
            xiuCount: window.filter(r => r === 0).length,
            volatility: Math.abs(scores[i] - scores[i-1]),
            trend: scores[i] > scores[i-1] ? 1 : 0
        };
        features.push(feature);
    }
    
    // Simple ML: Weighted voting based on features
    let tScore = 0, xScore = 0;
    let totalWeight = 0;
    const weights = {
        avgScore: 0.3,
        taiCount: 0.25,
        volatility: 0.2,
        trend: 0.25
    };
    
    if (features.length === 0) {
        return {
            prediction: results[results.length - 1] === 1 ? 'T' : 'X',
            confidence: 50,
            reason: 'Không đủ features'
        };
    }
    
    const lastFeature = features[features.length - 1];
    
    // avgScore
    if (lastFeature.avgScore > 11) {
        xScore += weights.avgScore;
        tScore += weights.avgScore * 0.3;
    } else if (lastFeature.avgScore < 9) {
        tScore += weights.avgScore;
        xScore += weights.avgScore * 0.3;
    }
    totalWeight += weights.avgScore;
    
    // taiCount
    if (lastFeature.taiCount > 6) {
        xScore += weights.taiCount;
    } else if (lastFeature.taiCount < 4) {
        tScore += weights.taiCount;
    }
    totalWeight += weights.taiCount;
    
    // volatility
    if (lastFeature.volatility > 3) {
        const pred = results[results.length - 1] === 1 ? 'X' : 'T';
        if (pred === 'T') tScore += weights.volatility;
        else xScore += weights.volatility;
    }
    totalWeight += weights.volatility;
    
    // trend
    if (lastFeature.trend === 1) {
        tScore += weights.trend;
    } else {
        xScore += weights.trend;
    }
    totalWeight += weights.trend;
    
    const finalPred = tScore > xScore ? 'T' : 'X';
    const confidence = totalWeight > 0 ? Math.round((Math.max(tScore, xScore) / totalWeight) * 100) : 50;
    
    return {
        prediction: finalPred,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason: `ML Ensemble (${Object.keys(features).length} features)`,
        features: lastFeature
    };
}

// 15. Phân tích cầu tổng hợp ULTIMATE
function analyzeUltimate(history, patterns) {
    if (history.length < 10) {
        return {
            prediction: 'T',
            confidence: 50,
            reason: 'Chưa đủ dữ liệu (cần 10 phiên)',
            algos: 0
        };
    }
    
    const predictions = [];
    const algoResults = {};
    
    // Tất cả thuật toán
    const algos = [
        { name: 'MarkovMatrix', func: analyzeMarkovMatrix },
        { name: 'AdvancedFibonacci', func: analyzeAdvancedFibonacci },
        { name: 'Pivot', func: analyzePivot },
        { name: 'Harmonic', func: analyzeHarmonic },
        { name: 'ElliotWave', func: analyzeElliotWave },
        { name: 'Gann', func: analyzeGann },
        { name: 'WolfeWave', func: analyzeWolfeWave },
        { name: 'FibRetracement', func: analyzeFibRetracement },
        { name: 'Kagi', func: analyzeKagi },
        { name: 'Renko', func: analyzeRenko },
        { name: 'Ichimoku', func: analyzeIchimoku },
        { name: 'MultiTimeframe', func: analyzeMultiTimeframe },
        { name: 'NeuralPattern', func: analyzeNeuralPattern },
        { name: 'MLEnsemble', func: analyzeMLEnsemble }
    ];
    
    // Chạy tất cả thuật toán
    for (const algo of algos) {
        try {
            const result = algo.func(history);
            if (result && result.prediction && result.confidence >= 50) {
                result.algo = algo.name;
                predictions.push(result);
                algoResults[algo.name] = result;
            }
        } catch (e) {
            // Bỏ qua lỗi
        }
    }
    
    if (predictions.length === 0) {
        const lastResult = history[history.length - 1].result;
        return {
            prediction: lastResult === 'T' ? 'X' : 'T',
            confidence: 50,
            reason: 'Không có tín hiệu, dùng fallback',
            algos: 0
        };
    }
    
    // Tính trọng số
    let tScore = 0, xScore = 0;
    let totalWeight = 0;
    let algoDetails = [];
    
    for (const pred of predictions) {
        const weight = (pred.confidence / 100) * (state.weights[pred.algo] || 1.0);
        if (pred.prediction === 'T') tScore += weight;
        else xScore += weight;
        totalWeight += weight;
        
        algoDetails.push({
            algo: pred.algo,
            prediction: pred.prediction,
            confidence: pred.confidence,
            reason: pred.reason,
            weight: weight
        });
    }
    
    // Sắp xếp theo confidence
    algoDetails.sort((a, b) => b.confidence - a.confidence);
    
    // Top 5 lý do
    const topReasons = algoDetails.slice(0, 5).map(d => `${d.algo}: ${d.reason} (${d.confidence}%)`);
    
    // Điều chỉnh độ tin cậy
    const confidenceBonus = Math.min(10, Math.floor(predictions.length / 2));
    const finalPred = tScore > xScore ? 'T' : 'X';
    let finalConfidence = Math.round((Math.max(tScore, xScore) / totalWeight) * 100);
    finalConfidence = Math.min(95, Math.max(50, finalConfidence + confidenceBonus));
    
    const bestAlgo = algoDetails[0];
    
    return {
        prediction: finalPred,
        confidence: finalConfidence,
        reason: bestAlgo ? bestAlgo.reason : 'Tổng hợp từ nhiều thuật toán',
        algos: predictions.length,
        details: topReasons,
        algoDetails: algoDetails.slice(0, 8),
        tScore: Math.round(tScore),
        xScore: Math.round(xScore),
        bestAlgo: bestAlgo ? bestAlgo.algo : 'N/A',
        bestAlgoConfidence: bestAlgo ? bestAlgo.confidence : 0
    };
}

// ==================== HÀM GỌI API ĐA LUỒNG ====================

async function fetchData(apiUrl) {
    try {
        const response = await axios.get(apiUrl, { timeout: 5000 });
        if (response.status === 200 && response.data) {
            return response.data;
        }
    } catch (e) {
        console.error('[❌] Lỗi fetch:', e.message);
    }
    return null;
}

function parseSessions(data) {
    if (!data || !data.data || !data.data.sessions) return [];
    
    const sessions = data.data.sessions;
    const parsed = [];
    
    for (const session of sessions) {
        if (session.status === 2) {
            parsed.push({
                phien: session.session_id,
                result: session.value === 1 ? 'T' : 'X',
                score: session.total || 0,
                dice: session.results || [],
                timestamp: new Date(session.time || Date.now())
            });
        }
    }
    
    return parsed;
}

// ==================== HÀM HIỂN THỊ ULTIMATE ====================

function displayUltimate(type, history, prediction, phien) {
    console.clear();
    console.log('╔═══════════════════════════════════════════════════════════════════════════════════════╗');
    console.log(`║  🎲 AI ULTIMATE - ${USER_ID}`);
    console.log('╠═══════════════════════════════════════════════════════════════════════════════════════╣');
    console.log(`║  📊 Lịch sử ${history.length} phiên:`);
    
    const displayHistory = history.slice(-20);
    let historyStr = '';
    for (let i = 0; i < displayHistory.length; i++) {
        const color = displayHistory[i].result === 'T' ? '\x1b[33m' : '\x1b[36m';
        const label = displayHistory[i].result === 'T' ? 'T' : 'X';
        historyStr += color + label + '\x1b[0m';
        if (i < displayHistory.length - 1) historyStr += ' ';
    }
    console.log(`║  ${historyStr}`);
    console.log('╠═══════════════════════════════════════════════════════════════════════════════════════╣');
    console.log(`║  🚀 PHIÊN: ${phien}`);
    
    const predColor = prediction.prediction === 'T' ? '\x1b[33m' : '\x1b[36m';
    const predLabel = prediction.prediction === 'T' ? 'TÀI' : 'XỈU';
    console.log(`║  🎯 DỰ ĐOÁN: ${predColor}${predLabel}\x1b[0m`);
    console.log(`║  📈 TỈ LỆ: ${prediction.confidence}%`);
    console.log(`║  🧠 SỐ THUẬT TOÁN: ${prediction.algos}`);
    console.log(`║  🏆 BEST: ${prediction.bestAlgo || 'N/A'} (${prediction.bestAlgoConfidence || 0}%)`);
    console.log(`║  📝 LÝ DO: ${prediction.reason}`);
    console.log('╠═══════════════════════════════════════════════════════════════════════════════════════╣');
    console.log(`║  📊 SCORE: TÀI=${prediction.tScore || 0} | XỈU=${prediction.xScore || 0}`);
    
    if (prediction.details && prediction.details.length > 0) {
        console.log('╠═══════════════════════════════════════════════════════════════════════════════════════╣');
        console.log('║  📋 TOP 5 THUẬT TOÁN:');
        for (const detail of prediction.details) {
            console.log(`║    - ${detail}`);
        }
    }
    
    if (prediction.algoDetails && prediction.algoDetails.length > 0) {
        console.log('╠═══════════════════════════════════════════════════════════════════════════════════════╣');
        console.log('║  🔬 CHI TIẾT THUẬT TOÁN:');
        for (const detail of prediction.algoDetails.slice(0, 5)) {
            const pred = detail.prediction === 'T' ? 'TÀI' : 'XỈU';
            const color = detail.prediction === 'T' ? '\x1b[33m' : '\x1b[36m';
            console.log(`║    ${detail.algo.padEnd(25)} ${color}${pred}\x1b[0m ${detail.confidence}%`);
        }
    }
    
    const stats = state.stats || { total: 0, correct: 0, wrong: 0 };
    const rate = stats.total ? Math.round(stats.correct / stats.total * 100) : 0;
    console.log('╠═══════════════════════════════════════════════════════════════════════════════════════╣');
    console.log(`║  📊 STATS: Đúng ${stats.correct}/${stats.total} (${rate}%) | Chuỗi ${state.stats?.streak || 0}`);
    console.log('╚═══════════════════════════════════════════════════════════════════════════════════════╝');
    
    console.log('\n📋 JSON:');
    console.log(JSON.stringify({
        phien: phien,
        du_doan: prediction.prediction === 'T' ? 'TÀI' : 'XỈU',
        ty_le: prediction.confidence + '%',
        so_thuat_toan: prediction.algos,
        thuat_toan_tot_nhat: prediction.bestAlgo || 'N/A',
        id: USER_ID
    }, null, 2));
}

// ==================== HÀM CHÍNH ====================

async function main() {
    loadAllData();
    
    // Khởi tạo weights
    const defaultWeights = {
        'MarkovMatrix': 1.0,
        'AdvancedFibonacci': 1.0,
        'Pivot': 1.0,
        'Harmonic': 1.0,
        'ElliotWave': 1.0,
        'Gann': 1.0,
        'WolfeWave': 1.0,
        'FibRetracement': 1.0,
        'Kagi': 1.0,
        'Renko': 1.0,
        'Ichimoku': 1.0,
        'MultiTimeframe': 1.0,
        'NeuralPattern': 1.0,
        'MLEnsemble': 1.0
    };
    
    for (const key in defaultWeights) {
        if (!state.weights[key]) state.weights[key] = 1.0;
    }
    
    console.log('🚀 KHỞI ĐỘNG AI ULTIMATE');
    console.log(`📡 API LC HŨ: ${API_LC_HU}`);
    console.log(`📡 API MD5: ${API_MD5}`);
    console.log('⏳ Đang chờ dữ liệu...\n');
    
    let lastPhien = null;
    let isReady = false;
    
    setInterval(async () => {
        try {
            const [data1, data2] = await Promise.all([
                fetchData(API_LC_HU),
                fetchData(API_MD5)
            ]);
            
            const sessions1 = parseSessions(data1);
            const sessions2 = parseSessions(data2);
            
            let allSessions = [...sessions1, ...sessions2];
            allSessions.sort((a, b) => a.phien - b.phien);
            
            if (allSessions.length === 0) return;
            
            const latest = allSessions[allSessions.length - 1];
            
            if (latest.phien === lastPhien) return;
            lastPhien = latest.phien;
            
            state.history.push(latest);
            if (state.history.length > 1000) state.history.shift();
            
            if (state.history.length >= 10) {
                isReady = true;
                saveAllData();
            }
            
            if (isReady) {
                const prediction = analyzeUltimate(state.history, state.patterns);
                
                if (state.history.length >= 2) {
                    const prevResult = state.history[state.history.length - 2]?.result;
                    if (prevResult) {
                        const correct = prevResult === prediction.prediction;
                        state.stats.total++;
                        if (correct) {
                            state.stats.correct++;
                            state.stats.streak = (state.stats.streak || 0) + 1;
                            if (state.stats.streak > state.stats.maxStreak) {
                                state.stats.maxStreak = state.stats.streak;
                            }
                        } else {
                            state.stats.wrong++;
                            state.stats.streak = 0;
                        }
                        saveAllData();
                    }
                }
                
                displayUltimate('ULTIMATE', state.history, prediction, latest.phien);
                
                const rate = state.stats.total ? Math.round(state.stats.correct / state.stats.total * 100) : 0;
                console.log(`\n📊 THỐNG KÊ: ${state.stats.correct}/${state.stats.total} (${rate}%) | Chuỗi: ${state.stats.streak || 0}`);
            } else {
                console.log(`[⏳] HỌC CẦU... ${state.history.length}/10`);
            }
            
        } catch (e) {
            // Bỏ qua lỗi
        }
    }, 3000);
}

// ==================== WORKER THREADS ====================

if (isMainThread) {
    // Main thread
    main();
} else {
    // Worker thread - xử lý dữ liệu song song
    parentPort.on('message', (data) => {
        const result = analyzeUltimate(data.history, data.patterns);
        parentPort.postMessage(result);
    });
}

// ==================== EXPORT ====================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        analyzeMarkovMatrix,
        analyzeAdvancedFibonacci,
        analyzePivot,
        analyzeHarmonic,
        analyzeElliotWave,
        analyzeGann,
        analyzeWolfeWave,
        analyzeFibRetracement,
        analyzeKagi,
        analyzeRenko,
        analyzeIchimoku,
        analyzeMultiTimeframe,
        analyzeNeuralPattern,
        analyzeMLEnsemble,
        analyzeUltimate
    };
}
