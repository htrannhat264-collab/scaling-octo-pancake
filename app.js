const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');

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
    MODEL: './model_state.json'
};

// ==================== BIẾN TOÀN CỤC ====================
let state = {
    history: [],
    patterns: {},
    weights: {},
    stats: { total: 0, correct: 0, wrong: 0, streak: 0, maxStreak: 0 },
    learningData: {},
    modelState: {}
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
                console.log(`[📂] Đã tải ${file}: ${Array.isArray(data) ? data.length : Object.keys(data).length} items`);
            }
        }
    } catch (e) {
        console.error('[❌] Lỗi load dữ liệu:', e.message);
    }
}

function saveAllData() {
    try {
        fs.writeFileSync(FILES.HISTORY, JSON.stringify(state.history, null, 2));
        fs.writeFileSync(FILES.PATTERNS, JSON.stringify(state.patterns, null, 2));
        fs.writeFileSync(FILES.WEIGHTS, JSON.stringify(state.weights, null, 2));
        fs.writeFileSync(FILES.STATS, JSON.stringify(state.stats, null, 2));
        fs.writeFileSync(FILES.LEARNING, JSON.stringify(state.learningData, null, 2));
        fs.writeFileSync(FILES.MODEL, JSON.stringify(state.modelState, null, 2));
    } catch (e) {
        console.error('[❌] Lỗi save dữ liệu:', e.message);
    }
}

// ==================== THUẬT TOÁN PHÂN TÍCH CƠ BẢN ====================

// 1. Phân tích chuỗi kết quả
function analyzeResultSequence(history) {
    if (history.length < 3) return null;
    const results = history.map(h => h.result);
    const last = results[results.length - 1];
    const prev = results[results.length - 2];
    
    // Đếm các pattern cơ bản
    let patterns = {
        TT: 0, TX: 0, XT: 0, XX: 0,
        TTT: 0, TTX: 0, TXT: 0, TXX: 0,
        XTT: 0, XTX: 0, XXT: 0, XXX: 0
    };
    
    for (let i = 0; i < results.length - 1; i++) {
        const key = results[i] + results[i+1];
        if (patterns[key] !== undefined) patterns[key]++;
    }
    
    for (let i = 0; i < results.length - 2; i++) {
        const key = results[i] + results[i+1] + results[i+2];
        if (patterns[key] !== undefined) patterns[key]++;
    }
    
    // Tính xác suất chuyển tiếp
    const totalTT = patterns.TT || 1;
    const totalTX = patterns.TX || 1;
    const totalXT = patterns.XT || 1;
    const totalXX = patterns.XX || 1;
    
    const transitionProbs = {
        T_to_T: patterns.TT / (patterns.TT + patterns.TX),
        T_to_X: patterns.TX / (patterns.TT + patterns.TX),
        X_to_T: patterns.XT / (patterns.XT + patterns.XX),
        X_to_X: patterns.XX / (patterns.XT + patterns.XX)
    };
    
    return {
        last,
        prev,
        patterns,
        transitionProbs,
        totalPairs: results.length - 1
    };
}

// 2. Phân tích cầu bệt siêu chi tiết
function analyzeSuperStreak(history) {
    if (history.length < 3) return null;
    
    const results = history.map(h => h.result);
    let streaks = [];
    let currentStreak = 1;
    let currentResult = results[0];
    let streakLengths = { T: [], X: [] };
    
    for (let i = 1; i < results.length; i++) {
        if (results[i] === currentResult) {
            currentStreak++;
        } else {
            streaks.push({ result: currentResult, length: currentStreak });
            streakLengths[currentResult].push(currentStreak);
            currentResult = results[i];
            currentStreak = 1;
        }
    }
    streaks.push({ result: currentResult, length: currentStreak });
    streakLengths[currentResult].push(currentStreak);
    
    const lastStreak = streaks[streaks.length - 1];
    const prevStreaks = streaks.slice(-5, -1);
    
    // Thống kê bệt
    const stats = {
        total: streaks.length,
        avgLength: streaks.reduce((s, st) => s + st.length, 0) / streaks.length,
        maxLength: Math.max(...streaks.map(s => s.length)),
        minLength: Math.min(...streaks.map(s => s.length)),
        taiStreaks: streakLengths.T,
        xiuStreaks: streakLengths.X,
        avgTai: streakLengths.T.length ? streakLengths.T.reduce((a,b) => a+b, 0) / streakLengths.T.length : 0,
        avgXiu: streakLengths.X.length ? streakLengths.X.reduce((a,b) => a+b, 0) / streakLengths.X.length : 0,
        lastStreak: lastStreak,
        prevStreaks: prevStreaks
    };
    
    // Phân tích xu hướng bệt
    let trend = {
        direction: 'none',
        strength: 0,
        confidence: 50
    };
    
    if (lastStreak.length > stats.avgLength * 1.5) {
        trend.direction = 'break';
        trend.strength = (lastStreak.length - stats.avgLength) / stats.avgLength;
        trend.confidence = Math.min(85, 60 + trend.strength * 20);
        trend.reason = `Bệt ${lastStreak.length} (TB ${stats.avgLength.toFixed(1)}), dự đoán bẻ`;
    } else if (lastStreak.length >= 3 && lastStreak.length <= 5) {
        trend.direction = 'continue';
        trend.strength = lastStreak.length / stats.avgLength;
        trend.confidence = Math.min(80, 60 + trend.strength * 15);
        trend.reason = `Bệt ${lastStreak.length}, tiếp tục`;
    } else if (lastStreak.length <= 2) {
        trend.direction = 'alternate';
        trend.strength = (3 - lastStreak.length) / 2;
        trend.confidence = Math.min(75, 55 + trend.strength * 20);
        trend.reason = `Bệt ngắn (${lastStreak.length}), dự đoán xen kẽ`;
    } else {
        trend.direction = 'uncertain';
        trend.confidence = 50;
        trend.reason = `Không xác định`;
    }
    
    return {
        stats,
        trend,
        prediction: trend.direction === 'break' ? (lastStreak.result === 'T' ? 'X' : 'T') :
                    trend.direction === 'continue' ? lastStreak.result :
                    trend.direction === 'alternate' ? (lastStreak.result === 'T' ? 'X' : 'T') :
                    lastStreak.result,
        confidence: trend.confidence,
        reason: trend.reason
    };
}

// 3. Phân tích cầu xen kẽ
function analyzeAlternatingPattern(history) {
    if (history.length < 6) return null;
    
    const results = history.map(h => h.result);
    let altCount = 0;
    let altRuns = [];
    let currentAltRun = 1;
    let maxAltRun = 0;
    
    for (let i = 1; i < results.length; i++) {
        if (results[i] !== results[i-1]) {
            altCount++;
            currentAltRun++;
        } else {
            if (currentAltRun > 1) {
                altRuns.push(currentAltRun);
                if (currentAltRun > maxAltRun) maxAltRun = currentAltRun;
                currentAltRun = 1;
            }
        }
    }
    if (currentAltRun > 1) {
        altRuns.push(currentAltRun);
        if (currentAltRun > maxAltRun) maxAltRun = currentAltRun;
    }
    
    const altRatio = altCount / (results.length - 1);
    const avgAltRun = altRuns.length ? altRuns.reduce((a,b) => a+b, 0) / altRuns.length : 0;
    
    // Kiểm tra các cửa sổ
    const windows = [3, 5, 7, 10];
    let windowData = {};
    for (const w of windows) {
        if (results.length >= w) {
            const recent = results.slice(-w);
            let count = 0;
            for (let i = 1; i < recent.length; i++) {
                if (recent[i] !== recent[i-1]) count++;
            }
            windowData[w] = {
                altRatio: count / (w - 1),
                isAlternating: count / (w - 1) > 0.7
            };
        }
    }
    
    // Dự đoán
    const lastResult = results[results.length - 1];
    const otherResult = lastResult === 'T' ? 'X' : 'T';
    
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (altRatio > 0.75) {
        prediction = otherResult;
        confidence = Math.min(85, 65 + altRatio * 25);
        reason = `Xen kẽ mạnh (${(altRatio*100).toFixed(0)}%)`;
    } else if (altRatio > 0.6 && windowData[5]?.isAlternating) {
        prediction = otherResult;
        confidence = 70;
        reason = `Xen kẽ (${(altRatio*100).toFixed(0)}%), 5 phiên gần nhất xen kẽ`;
    } else if (altRatio < 0.3 && windowData[7]?.altRatio < 0.3) {
        prediction = lastResult;
        confidence = 65;
        reason = `Ít xen kẽ (${(altRatio*100).toFixed(0)}%), tiếp tục xu hướng`;
    } else {
        prediction = lastResult;
        confidence = 55;
        reason = `Không có xen kẽ rõ ràng`;
    }
    
    return {
        prediction,
        confidence,
        reason,
        altRatio,
        avgAltRun,
        maxAltRun,
        windowData,
        totalAltRuns: altRuns.length
    };
}

// 4. Phân tích cầu 2-2
function analyzePattern22(history) {
    if (history.length < 8) return null;
    
    const results = history.map(h => h.result);
    let pattern22Count = 0;
    let pattern22Positions = [];
    let pattern22Results = [];
    
    for (let i = 0; i <= results.length - 4; i++) {
        if (results[i] === results[i+1] &&
            results[i+2] === results[i+3] &&
            results[i] !== results[i+2]) {
            pattern22Count++;
            pattern22Positions.push(i);
            pattern22Results.push({
                first: results[i],
                second: results[i+2],
                position: i
            });
        }
    }
    
    const last4 = results.slice(-4);
    const is22 = last4[0] === last4[1] && last4[2] === last4[3] && last4[0] !== last4[2];
    const ratio = pattern22Count / Math.max(1, results.length - 3);
    
    // Phân tích các cầu 2-2 gần đây
    let recent22 = [];
    for (let i = results.length - 4; i >= 0; i--) {
        if (i <= results.length - 4 &&
            results[i] === results[i+1] &&
            results[i+2] === results[i+3] &&
            results[i] !== results[i+2]) {
            recent22.push({
                position: i,
                pattern: results[i] + results[i+1] + results[i+2] + results[i+3]
            });
            if (recent22.length >= 3) break;
        }
    }
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (is22) {
        prediction = last4[3] === 'T' ? 'X' : 'T';
        confidence = Math.min(85, 65 + ratio * 25);
        reason = `Cầu 2-2 (tần suất ${(ratio*100).toFixed(0)}%)`;
    } else if (ratio > 0.3) {
        const lastTwo = results.slice(-2);
        if (lastTwo[0] === lastTwo[1]) {
            prediction = lastTwo[0] === 'T' ? 'X' : 'T';
            confidence = 60 + ratio * 20;
            reason = `Có khả năng cầu 2-2 (tần suất ${(ratio*100).toFixed(0)}%)`;
        } else {
            prediction = results[results.length - 1];
            confidence = 55;
            reason = `Chờ tín hiệu cầu 2-2`;
        }
    } else {
        prediction = results[results.length - 1];
        confidence = 50;
        reason = `Không có cầu 2-2`;
    }
    
    return {
        prediction,
        confidence,
        reason,
        count: pattern22Count,
        ratio,
        is22,
        recent22,
        totalPositions: pattern22Positions
    };
}

// 5. Phân tích cầu 3-3
function analyzePattern33(history) {
    if (history.length < 10) return null;
    
    const results = history.map(h => h.result);
    let pattern33Count = 0;
    let pattern33Positions = [];
    
    for (let i = 0; i <= results.length - 6; i++) {
        if (results[i] === results[i+1] && results[i+1] === results[i+2] &&
            results[i+3] === results[i+4] && results[i+4] === results[i+5] &&
            results[i] !== results[i+3]) {
            pattern33Count++;
            pattern33Positions.push(i);
        }
    }
    
    const last6 = results.slice(-6);
    const is33 = last6[0] === last6[1] && last6[1] === last6[2] &&
                 last6[3] === last6[4] && last6[4] === last6[5] &&
                 last6[0] !== last6[3];
    const ratio = pattern33Count / Math.max(1, results.length - 5);
    
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (is33) {
        prediction = last6[5] === 'T' ? 'X' : 'T';
        confidence = Math.min(85, 65 + ratio * 25);
        reason = `Cầu 3-3 (tần suất ${(ratio*100).toFixed(0)}%)`;
    } else if (ratio > 0.25) {
        const last3 = results.slice(-3);
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
            prediction = last3[0] === 'T' ? 'X' : 'T';
            confidence = 60 + ratio * 20;
            reason = `Có khả năng cầu 3-3 (tần suất ${(ratio*100).toFixed(0)}%)`;
        } else {
            prediction = results[results.length - 1];
            confidence = 55;
            reason = `Chờ tín hiệu cầu 3-3`;
        }
    } else {
        prediction = results[results.length - 1];
        confidence = 50;
        reason = `Không có cầu 3-3`;
    }
    
    return {
        prediction,
        confidence,
        reason,
        count: pattern33Count,
        ratio,
        is33,
        positions: pattern33Positions
    };
}

// 6. Phân tích cầu 1-2-1 và 2-1-2
function analyzeSpecialPatterns(history) {
    if (history.length < 7) return null;
    
    const results = history.map(h => h.result);
    let pattern121Count = 0;
    let pattern212Count = 0;
    let pattern121Positions = [];
    let pattern212Positions = [];
    
    for (let i = 0; i <= results.length - 5; i++) {
        // 1-2-1: X T T X T
        if (results[i] !== results[i+1] &&
            results[i+1] === results[i+2] &&
            results[i+2] !== results[i+3] &&
            results[i+3] === results[i+4] &&
            results[i] === results[i+3]) {
            pattern121Count++;
            pattern121Positions.push(i);
        }
        // 2-1-2: T X X T X
        if (results[i] === results[i+1] &&
            results[i+1] !== results[i+2] &&
            results[i+2] === results[i+3] &&
            results[i+3] !== results[i+4] &&
            results[i] === results[i+3]) {
            pattern212Count++;
            pattern212Positions.push(i);
        }
    }
    
    const last5 = results.slice(-5);
    const is121 = last5[0] !== last5[1] && last5[1] === last5[2] &&
                  last5[2] !== last5[3] && last5[3] === last5[4] &&
                  last5[0] === last5[3];
    const is212 = last5[0] === last5[1] && last5[1] !== last5[2] &&
                  last5[2] === last5[3] && last5[3] !== last5[4] &&
                  last5[0] === last5[3];
    
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (is121) {
        prediction = last5[4] === 'T' ? 'X' : 'T';
        confidence = 75;
        reason = `Cầu 1-2-1 (xuất hiện ${pattern121Count} lần)`;
    } else if (is212) {
        prediction = last5[4] === 'T' ? 'X' : 'T';
        confidence = 75;
        reason = `Cầu 2-1-2 (xuất hiện ${pattern212Count} lần)`;
    } else if (pattern121Count > 0 && pattern121Positions[pattern121Positions.length - 1] > results.length - 10) {
        prediction = results[results.length - 1] === 'T' ? 'X' : 'T';
        confidence = 65;
        reason = `Có khả năng cầu 1-2-1 (${pattern121Count} lần)`;
    } else if (pattern212Count > 0 && pattern212Positions[pattern212Positions.length - 1] > results.length - 10) {
        prediction = results[results.length - 1] === 'T' ? 'X' : 'T';
        confidence = 65;
        reason = `Có khả năng cầu 2-1-2 (${pattern212Count} lần)`;
    } else {
        prediction = results[results.length - 1];
        confidence = 50;
        reason = `Không có cầu đặc biệt`;
    }
    
    return {
        prediction,
        confidence,
        reason,
        pattern121Count,
        pattern212Count,
        is121,
        is212
    };
}

// 7. Phân tích cân bằng siêu chi tiết
function analyzeSuperBalance(history) {
    if (history.length < 15) return null;
    
    const results = history.map(h => h.result);
    const total = results.length;
    const taiCount = results.filter(r => r === 'T').length;
    const xiuCount = total - taiCount;
    
    // Các cửa sổ khác nhau
    const windows = [3, 5, 7, 10, 15, 20, 30, 50];
    let windowData = {};
    let windowTrends = [];
    
    for (const w of windows) {
        if (total >= w) {
            const recent = results.slice(-w);
            const t = recent.filter(r => r === 'T').length;
            const x = w - t;
            windowData[w] = {
                tai: t,
                xiu: x,
                ratio: t / w,
                imbalance: Math.abs(t - x) / w
            };
            windowTrends.push({ window: w, ratio: t / w });
        }
    }
    
    // Phân tích xu hướng qua các cửa sổ
    let trend = 'neutral';
    let trendStrength = 0;
    if (windowData[5] && windowData[10] && windowData[20]) {
        const r5 = windowData[5].ratio;
        const r10 = windowData[10].ratio;
        const r20 = windowData[20].ratio;
        
        if (r5 > r10 && r10 > r20) {
            trend = 'tai_increasing';
            trendStrength = (r5 - r20) / 2;
        } else if (r5 < r10 && r10 < r20) {
            trend = 'xiu_increasing';
            trendStrength = (r20 - r5) / 2;
        }
    }
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    const r5 = windowData[5]?.ratio || 0.5;
    const r10 = windowData[10]?.ratio || 0.5;
    const r20 = windowData[20]?.ratio || 0.5;
    const imb5 = windowData[5]?.imbalance || 0;
    const imb10 = windowData[10]?.imbalance || 0;
    
    // Mất cân bằng mạnh
    if (imb5 > 0.6) {
        prediction = r5 > 0.5 ? 'X' : 'T';
        confidence = Math.min(85, 65 + imb5 * 30);
        reason = `Mất cân bằng mạnh (${Math.abs(r5-0.5)*100}%)`;
    } else if (imb10 > 0.4) {
        prediction = r10 > 0.5 ? 'X' : 'T';
        confidence = Math.min(80, 60 + imb10 * 25);
        reason = `Mất cân bằng (${Math.abs(r10-0.5)*100}%)`;
    } 
    // Theo xu hướng
    else if (trend === 'tai_increasing' && trendStrength > 0.1) {
        prediction = 'T';
        confidence = 65 + trendStrength * 20;
        reason = `Xu hướng Tài tăng (${(trendStrength*100).toFixed(0)}%)`;
    } else if (trend === 'xiu_increasing' && trendStrength > 0.1) {
        prediction = 'X';
        confidence = 65 + trendStrength * 20;
        reason = `Xu hướng Xỉu tăng (${(trendStrength*100).toFixed(0)}%)`;
    } 
    // Cân bằng
    else {
        prediction = results[results.length - 1];
        confidence = 52;
        reason = `Cân bằng, theo xu hướng cuối`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        windowData,
        trend,
        trendStrength,
        totalTai: taiCount,
        totalXiu: xiuCount,
        taiRatio: taiCount / total
    };
}

// 8. Phân tích điểm số và xúc xắc
function analyzeScoreAndDice(history) {
    if (history.length < 10) return null;
    
    const scores = history.map(h => h.score || 0);
    const diceData = history.filter(h => h.dice && h.dice.length === 3);
    
    // Phân tích điểm số
    const scoreStats = {
        avg: scores.reduce((a,b) => a+b, 0) / scores.length,
        max: Math.max(...scores),
        min: Math.min(...scores),
        last: scores[scores.length - 1],
        recent5: scores.slice(-5).reduce((a,b) => a+b, 0) / Math.min(5, scores.length),
        recent10: scores.slice(-10).reduce((a,b) => a+b, 0) / Math.min(10, scores.length),
        stdDev: Math.sqrt(scores.reduce((sum, s) => sum + Math.pow(s - scores.reduce((a,b) => a+b, 0) / scores.length, 2), 0) / scores.length)
    };
    
    // Phân tích xúc xắc
    let diceFreq = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    let dicePairs = {};
    let diceTriples = {};
    
    for (const d of diceData) {
        const sorted = [...d.dice].sort((a,b) => a-b);
        const key = sorted.join(',');
        diceTriples[key] = (diceTriples[key] || 0) + 1;
        
        for (let i = 0; i < d.dice.length; i++) {
            diceFreq[d.dice[i]] = (diceFreq[d.dice[i]] || 0) + 1;
            
            for (let j = i + 1; j < d.dice.length; j++) {
                const pairKey = [d.dice[i], d.dice[j]].sort((a,b) => a-b).join(',');
                dicePairs[pairKey] = (dicePairs[pairKey] || 0) + 1;
            }
        }
    }
    
    const totalDice = Object.values(diceFreq).reduce((a,b) => a+b, 0);
    const diceProb = {};
    for (const [face, count] of Object.entries(diceFreq)) {
        diceProb[face] = count / totalDice;
    }
    
    // Dự đoán dựa trên điểm số
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    const lastScore = scoreStats.last;
    const avgScore = scoreStats.avg;
    const recent5 = scoreStats.recent5;
    const recent10 = scoreStats.recent10;
    
    if (lastScore > 14) {
        prediction = 'X';
        confidence = 65 + (lastScore - 14) * 2;
        reason = `Điểm cao ${lastScore} (TB ${avgScore.toFixed(1)})`;
    } else if (lastScore < 6) {
        prediction = 'T';
        confidence = 65 + (6 - lastScore) * 2;
        reason = `Điểm thấp ${lastScore} (TB ${avgScore.toFixed(1)})`;
    } else if (recent5 > avgScore + 2) {
        prediction = 'X';
        confidence = 60;
        reason = `Điểm đang tăng (${recent5.toFixed(1)} > ${avgScore.toFixed(1)})`;
    } else if (recent5 < avgScore - 2) {
        prediction = 'T';
        confidence = 60;
        reason = `Điểm đang giảm (${recent5.toFixed(1)} < ${avgScore.toFixed(1)})`;
    } else {
        prediction = lastScore > 11 ? 'X' : 'T';
        confidence = 52;
        reason = `Điểm ${lastScore} ở mức ${lastScore > 11 ? 'cao' : 'thấp'}`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        scoreStats,
        diceFreq,
        diceProb,
        dicePairs,
        diceTriples
    };
}

// 9. Phân tích chu kỳ siêu chi tiết
function analyzeSuperCycle(history) {
    if (history.length < 20) return null;
    
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    let cycles = {};
    let cycleStrengths = {};
    
    for (let cycle = 2; cycle <= 20; cycle++) {
        let matches = 0;
        let total = 0;
        let matchPositions = [];
        
        for (let i = cycle; i < results.length; i++) {
            if (results[i] === results[i - cycle]) {
                matches++;
                matchPositions.push(i);
            }
            total++;
        }
        
        cycles[cycle] = {
            strength: matches / total,
            count: matches,
            total: total,
            positions: matchPositions
        };
        cycleStrengths[cycle] = matches / total;
    }
    
    // Tìm chu kỳ mạnh nhất
    let bestCycle = 2;
    let bestStrength = 0;
    for (const c in cycles) {
        if (cycles[c].strength > bestStrength) {
            bestStrength = cycles[c].strength;
            bestCycle = parseInt(c);
        }
    }
    
    // Kiểm tra chu kỳ đang lặp
    const lastCycle = results.slice(-bestCycle);
    const prevCycle = results.slice(-bestCycle*2, -bestCycle);
    const isRepeating = JSON.stringify(lastCycle) === JSON.stringify(prevCycle);
    
    // Tìm chu kỳ con
    let subCycles = {};
    for (let cycle = 2; cycle <= 10; cycle++) {
        if (bestCycle % cycle === 0) {
            subCycles[cycle] = cycles[cycle]?.strength || 0;
        }
    }
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (isRepeating && bestStrength > 0.7) {
        prediction = lastCycle[0] === 1 ? 'T' : 'X';
        confidence = Math.min(85, 65 + bestStrength * 25);
        reason = `Chu kỳ ${bestCycle} đang lặp (${(bestStrength*100).toFixed(0)}%)`;
    } else if (bestStrength > 0.65) {
        const nextPred = results[results.length - bestCycle] === 1 ? 'T' : 'X';
        prediction = nextPred;
        confidence = 60 + (bestStrength - 0.65) * 50;
        reason = `Phát hiện chu kỳ ${bestCycle} (${(bestStrength*100).toFixed(0)}%)`;
    } else if (Object.values(cycleStrengths).filter(s => s > 0.6).length >= 2) {
        // Nhiều chu kỳ yếu
        prediction = results[results.length - 1] === 1 ? 'X' : 'T';
        confidence = 55;
        reason = `Nhiều chu kỳ yếu, dự đoán đảo`;
    } else {
        prediction = results[results.length - 1] === 1 ? 'T' : 'X';
        confidence = 50;
        reason = `Không có chu kỳ rõ ràng`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        bestCycle,
        bestStrength,
        isRepeating,
        cycles,
        subCycles,
        allStrengths: cycleStrengths
    };
}

// 10. Phân tích Fibonacci nâng cao
function analyzeSuperFibonacci(history) {
    if (history.length < 21) return null;
    
    const fibs = [1, 1, 2, 3, 5, 8, 13, 21, 34];
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    let fibMatches = {};
    let totalMatches = 0;
    let matchDetails = [];
    
    for (const f of fibs) {
        if (history.length > f) {
            const match = results[results.length - f] === results[results.length - 1];
            fibMatches[f] = match;
            if (match) {
                totalMatches++;
                matchDetails.push({
                    fib: f,
                    value: results[results.length - f],
                    current: results[results.length - 1]
                });
            }
        }
    }
    
    const strength = totalMatches / Object.keys(fibMatches).length;
    
    // Phân tích theo tổng Fibonacci
    let fibSum = 0;
    for (const f of fibs) {
        if (history.length > f) {
            fibSum += results[results.length - f];
        }
    }
    const fibAvg = fibSum / Object.keys(fibMatches).length;
    const fibTrend = fibAvg > 0.5 ? 'tai' : 'xiu';
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (strength > 0.7) {
        prediction = results[results.length - 1] === 1 ? 'X' : 'T';
        confidence = Math.min(85, 65 + strength * 25);
        reason = `Fibonacci mạnh (${(strength*100).toFixed(0)}% khớp)`;
    } else if (strength > 0.55) {
        prediction = results[results.length - 1] === 1 ? 'X' : 'T';
        confidence = 60 + strength * 20;
        reason = `Fibonacci (${(strength*100).toFixed(0)}% khớp)`;
    } else if (fibTrend === 'tai' && results[results.length - 1] === 0) {
        prediction = 'T';
        confidence = 58;
        reason = `Xu hướng Fibonacci Tài`;
    } else if (fibTrend === 'xiu' && results[results.length - 1] === 1) {
        prediction = 'X';
        confidence = 58;
        reason = `Xu hướng Fibonacci Xỉu`;
    } else {
        prediction = results[results.length - 1] === 1 ? 'T' : 'X';
        confidence = 50;
        reason = `Fibonacci yếu`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        strength,
        matches: fibMatches,
        matchDetails,
        totalMatches,
        fibAvg,
        fibTrend
    };
}

// 11. Phân tích pattern đã học
function analyzeLearnedPatterns(history, patterns) {
    if (history.length < 5 || Object.keys(patterns).length === 0) return null;
    
    const results = history.map(h => h.result);
    const lastN = results.slice(-8).join('');
    let bestMatches = [];
    
    // Tìm các pattern khớp
    for (let len = 8; len >= 3; len--) {
        const pattern = lastN.slice(-len);
        if (patterns[pattern] && patterns[pattern].total >= 2) {
            const data = patterns[pattern];
            const score = data.confidence * data.strength;
            bestMatches.push({
                pattern: pattern,
                len: len,
                data: data,
                score: score,
                prediction: data.taiProb > data.xiuProb ? 'T' : 'X',
                confidence: 50 + data.confidence * 40
            });
        }
    }
    
    if (bestMatches.length === 0) return null;
    
    // Sắp xếp theo điểm số
    bestMatches.sort((a, b) => b.score - a.score);
    const best = bestMatches[0];
    
    // Tìm các pattern liên quan
    let relatedPatterns = [];
    for (const match of bestMatches.slice(0, 3)) {
        relatedPatterns.push({
            pattern: match.pattern,
            confidence: match.confidence,
            prediction: match.prediction
        });
    }
    
    return {
        prediction: best.prediction,
        confidence: Math.min(85, Math.max(50, best.confidence)),
        reason: `Pattern "${best.pattern}" (${best.data.total} lần, ${(best.data.confidence*100).toFixed(0)}% chênh lệch)`,
        pattern: best.pattern,
        totalOccurrences: best.data.total,
        taiProb: best.data.taiProb,
        xiuProb: best.data.xiuProb,
        relatedPatterns,
        bestMatches: bestMatches.slice(0, 3)
    };
}

// 12. Phân tích chỉ báo kỹ thuật nâng cao
function analyzeTechnicalIndicators(history) {
    if (history.length < 20) return null;
    
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    let signals = [];
    let signalDetails = [];
    
    // 12.1 RSI (Relative Strength Index)
    let gains = 0, losses = 0;
    for (let i = 1; i < results.length; i++) {
        const diff = results[i] - results[i-1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }
    const avgGain = gains / (results.length - 1);
    const avgLoss = losses / (results.length - 1);
    let rsi = 50;
    if (avgLoss === 0) rsi = 100;
    else if (avgGain === 0) rsi = 0;
    else rsi = 100 - (100 / (1 + avgGain / avgLoss));
    
    if (rsi > 75) {
        signals.push({ pred: 'X', weight: 0.9, reason: 'RSI quá mua (>75)' });
        signalDetails.push(`RSI: ${rsi.toFixed(1)}`);
    } else if (rsi > 65) {
        signals.push({ pred: 'X', weight: 0.6, reason: 'RSI gần quá mua' });
        signalDetails.push(`RSI: ${rsi.toFixed(1)}`);
    } else if (rsi < 25) {
        signals.push({ pred: 'T', weight: 0.9, reason: 'RSI quá bán (<25)' });
        signalDetails.push(`RSI: ${rsi.toFixed(1)}`);
    } else if (rsi < 35) {
        signals.push({ pred: 'T', weight: 0.6, reason: 'RSI gần quá bán' });
        signalDetails.push(`RSI: ${rsi.toFixed(1)}`);
    }
    
    // 12.2 Moving Averages
    const ma5 = results.slice(-5).reduce((a,b) => a+b, 0) / 5;
    const ma10 = results.slice(-10).reduce((a,b) => a+b, 0) / 10;
    const ma20 = results.slice(-20).reduce((a,b) => a+b, 0) / 20;
    const ma50 = results.length >= 50 ? results.slice(-50).reduce((a,b) => a+b, 0) / 50 : null;
    
    if (ma5 > ma10 && ma10 > ma20) {
        signals.push({ pred: 'T', weight: 0.7, reason: 'MA5 > MA10 > MA20' });
        signalDetails.push(`MA5:${ma5.toFixed(2)}, MA10:${ma10.toFixed(2)}, MA20:${ma20.toFixed(2)}`);
    } else if (ma5 < ma10 && ma10 < ma20) {
        signals.push({ pred: 'X', weight: 0.7, reason: 'MA5 < MA10 < MA20' });
        signalDetails.push(`MA5:${ma5.toFixed(2)}, MA10:${ma10.toFixed(2)}, MA20:${ma20.toFixed(2)}`);
    } else if (ma5 > ma10 && ma5 > ma20) {
        signals.push({ pred: 'T', weight: 0.5, reason: 'MA5 cao nhất' });
    } else if (ma5 < ma10 && ma5 < ma20) {
        signals.push({ pred: 'X', weight: 0.5, reason: 'MA5 thấp nhất' });
    }
    
    // 12.3 Bollinger Bands
    const mean = results.reduce((a,b) => a+b, 0) / results.length;
    const variance2 = results.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / results.length;
    const std = Math.sqrt(variance2);
    const upper = mean + 2 * std;
    const lower = mean - 2 * std;
    const last = results[results.length - 1];
    
    if (last > upper) {
        signals.push({ pred: 'X', weight: 0.8, reason: 'Giá chạm upper band' });
        signalDetails.push(`Upper: ${upper.toFixed(2)}, Lower: ${lower.toFixed(2)}`);
    } else if (last < lower) {
        signals.push({ pred: 'T', weight: 0.8, reason: 'Giá chạm lower band' });
        signalDetails.push(`Upper: ${upper.toFixed(2)}, Lower: ${lower.toFixed(2)}`);
    }
    
    // 12.4 MACD
    const ema12 = results.slice(-12).reduce((a,b) => a+b, 0) / 12;
    const ema26 = results.length >= 26 ? results.slice(-26).reduce((a,b) => a+b, 0) / 26 : ema12;
    const macd = ema12 - ema26;
    const signalLine = macd * 0.8;
    
    if (macd > signalLine) {
        signals.push({ pred: 'T', weight: 0.5, reason: 'MACD > signal' });
        signalDetails.push(`MACD: ${macd.toFixed(3)}`);
    } else if (macd < signalLine) {
        signals.push({ pred: 'X', weight: 0.5, reason: 'MACD < signal' });
        signalDetails.push(`MACD: ${macd.toFixed(3)}`);
    }
    
    // 12.5 Stochastic
    const period14 = Math.min(14, results.length);
    const highest14 = Math.max(...results.slice(-period14));
    const lowest14 = Math.min(...results.slice(-period14));
    if (highest14 !== lowest14) {
        const k = (last - lowest14) / (highest14 - lowest14) * 100;
        if (k > 80) {
            signals.push({ pred: 'X', weight: 0.7, reason: 'Stochastic > 80' });
            signalDetails.push(`Stochastic: ${k.toFixed(1)}`);
        } else if (k < 20) {
            signals.push({ pred: 'T', weight: 0.7, reason: 'Stochastic < 20' });
            signalDetails.push(`Stochastic: ${k.toFixed(1)}`);
        }
    }
    
    // 12.6 Williams %R
    if (highest14 !== lowest14) {
        const wr = (highest14 - last) / (highest14 - lowest14) * -100;
        if (wr < -80) {
            signals.push({ pred: 'T', weight: 0.6, reason: 'Williams %R < -80' });
            signalDetails.push(`W%R: ${wr.toFixed(1)}`);
        } else if (wr > -20) {
            signals.push({ pred: 'X', weight: 0.6, reason: 'Williams %R > -20' });
            signalDetails.push(`W%R: ${wr.toFixed(1)}`);
        }
    }
    
    // 12.7 CCI
    const period10 = Math.min(10, results.length);
    const recent10 = results.slice(-period10);
    const mean10 = recent10.reduce((a,b) => a+b, 0) / period10;
    const mad = recent10.reduce((sum, x) => sum + Math.abs(x - mean10), 0) / period10;
    if (mad > 0) {
        const cci = (last - mean10) / (0.015 * mad);
        if (cci > 100) {
            signals.push({ pred: 'X', weight: 0.5, reason: 'CCI > 100' });
            signalDetails.push(`CCI: ${cci.toFixed(1)}`);
        } else if (cci < -100) {
            signals.push({ pred: 'T', weight: 0.5, reason: 'CCI < -100' });
            signalDetails.push(`CCI: ${cci.toFixed(1)}`);
        }
    }
    
    // 12.8 Entropy
    const p_t = results.filter(r => r === 1).length / results.length;
    if (p_t > 0 && p_t < 1) {
        const entropy = -p_t * Math.log2(p_t) - (1 - p_t) * Math.log2(1 - p_t);
        if (entropy > 0.95) {
            signals.push({ pred: last === 1 ? 'X' : 'T', weight: 0.4, reason: 'Entropy cao (>0.95)' });
            signalDetails.push(`Entropy: ${entropy.toFixed(3)}`);
        }
    }
    
    // Tổng hợp tín hiệu
    if (signals.length === 0) {
        return {
            prediction: last === 1 ? 'T' : 'X',
            confidence: 50,
            reason: 'Không có tín hiệu kỹ thuật',
            signals: 0,
            rsi,
            ma5,
            ma10,
            ma20
        };
    }
    
    let tWeight = 0, xWeight = 0;
    let tReasons = [], xReasons = [];
    
    for (const s of signals) {
        if (s.pred === 'T') {
            tWeight += s.weight;
            tReasons.push(s.reason);
        } else {
            xWeight += s.weight;
            xReasons.push(s.reason);
        }
    }
    
    const totalWeight = tWeight + xWeight;
    const pred = tWeight > xWeight ? 'T' : 'X';
    const confidence = 50 + (Math.abs(tWeight - xWeight) / totalWeight) * 40;
    const reason = (pred === 'T' ? tReasons : xReasons).join('; ');
    
    return {
        prediction: pred,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason: `Kỹ thuật: ${reason}`,
        signals: signals.length,
        signalDetails: signalDetails.join(' | '),
        rsi,
        ma5,
        ma10,
        ma20,
        rsi,
        macd: macd || 0
    };
}

// 13. Phân tích cầu đảo chiều
function analyzeReversalPattern(history) {
    if (history.length < 8) return null;
    
    const results = history.map(h => h.result);
    const last8 = results.slice(-8);
    let changes = 0;
    let changePositions = [];
    
    for (let i = 1; i < last8.length; i++) {
        if (last8[i] !== last8[i-1]) {
            changes++;
            changePositions.push(i);
        }
    }
    
    const changeRatio = changes / (last8.length - 1);
    
    // Phân tích các mẫu đảo chiều
    let reversalPatterns = [];
    
    // Mẫu đảo chiều 1-2-1
    if (last8.length >= 5) {
        const last5 = last8.slice(-5);
        if (last5[0] !== last5[1] && last5[1] !== last5[2] &&
            last5[2] === last5[3] && last5[3] !== last5[4]) {
            reversalPatterns.push({
                type: '1-2-1 reversal',
                confidence: 70,
                prediction: last5[4] === 'T' ? 'X' : 'T'
            });
        }
    }
    
    // Mẫu đảo chiều 2-1-2
    if (last8.length >= 5) {
        const last5 = last8.slice(-5);
        if (last5[0] === last5[1] && last5[1] !== last5[2] &&
            last5[2] !== last5[3] && last5[3] === last5[4]) {
            reversalPatterns.push({
                type: '2-1-2 reversal',
                confidence: 70,
                prediction: last5[4] === 'T' ? 'X' : 'T'
            });
        }
    }
    
    // Mẫu đảo chiều double top/bottom
    if (last8.length >= 6) {
        const last6 = last8.slice(-6);
        if (last6[0] === last6[2] && last6[2] === last6[4] &&
            last6[0] !== last6[1] && last6[1] === last6[3] && last6[3] === last6[5]) {
            reversalPatterns.push({
                type: 'double pattern',
                confidence: 75,
                prediction: last6[5] === 'T' ? 'X' : 'T'
            });
        }
    }
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    if (reversalPatterns.length > 0) {
        const best = reversalPatterns.reduce((a, b) => a.confidence > b.confidence ? a : b);
        prediction = best.prediction;
        confidence = best.confidence;
        reason = `Phát hiện mẫu ${best.type}`;
    } else if (changeRatio > 0.75) {
        prediction = last8[last8.length - 1] === 'T' ? 'X' : 'T';
        confidence = 65;
        reason = `Đảo chiều mạnh (${(changeRatio*100).toFixed(0)}%)`;
    } else if (changeRatio < 0.3) {
        prediction = last8[last8.length - 1];
        confidence = 60;
        reason = `Ít đảo chiều (${(changeRatio*100).toFixed(0)}%), tiếp tục xu hướng`;
    } else {
        prediction = last8[last8.length - 1];
        confidence = 50;
        reason = `Không có mẫu đảo chiều rõ ràng`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        changeRatio,
        changes,
        reversalPatterns,
        totalPatterns: reversalPatterns.length
    };
}

// 14. Phân tích tổng hợp Momentum
function analyzeMomentum(history) {
    if (history.length < 15) return null;
    
    const results = history.map(h => h.result === 'T' ? 1 : 0);
    
    // Tính momentum qua các cửa sổ
    const windows = [3, 5, 7, 10, 15];
    let momentumData = {};
    
    for (const w of windows) {
        if (results.length >= w) {
            const recent = results.slice(-w);
            const sum = recent.reduce((a,b) => a+b, 0);
            const ratio = sum / w;
            momentumData[w] = {
                ratio,
                value: sum,
                momentum: ratio - 0.5
            };
        }
    }
    
    // Tính đạo hàm momentum (tốc độ thay đổi)
    let derivatives = [];
    for (let i = 5; i < results.length; i++) {
        const current = results.slice(i-4, i+1).reduce((a,b) => a+b, 0) / 5;
        const prev = results.slice(i-9, i-4).reduce((a,b) => a+b, 0) / 5;
        derivatives.push(current - prev);
    }
    
    const avgDerivative = derivatives.length ? derivatives.reduce((a,b) => a+b, 0) / derivatives.length : 0;
    const lastDerivative = derivatives.length ? derivatives[derivatives.length - 1] : 0;
    
    // Dự đoán
    let prediction = null;
    let confidence = 50;
    let reason = '';
    
    const m3 = momentumData[3]?.momentum || 0;
    const m5 = momentumData[5]?.momentum || 0;
    const m10 = momentumData[10]?.momentum || 0;
    
    if (m3 > 0.3 && m5 > 0.2) {
        prediction = 'T';
        confidence = 65 + m3 * 30;
        reason = `Momentum Tài mạnh (${(m3*100).toFixed(0)}%)`;
    } else if (m3 < -0.3 && m5 < -0.2) {
        prediction = 'X';
        confidence = 65 + Math.abs(m3) * 30;
        reason = `Momentum Xỉu mạnh (${(Math.abs(m3)*100).toFixed(0)}%)`;
    } else if (lastDerivative > 0.1 && avgDerivative > 0) {
        prediction = 'T';
        confidence = 60;
        reason = `Momentum đang tăng`;
    } else if (lastDerivative < -0.1 && avgDerivative < 0) {
        prediction = 'X';
        confidence = 60;
        reason = `Momentum đang giảm`;
    } else {
        prediction = results[results.length - 1] === 1 ? 'T' : 'X';
        confidence = 52;
        reason = `Momentum trung tính`;
    }
    
    return {
        prediction,
        confidence: Math.min(85, Math.max(50, confidence)),
        reason,
        momentumData,
        avgDerivative,
        lastDerivative
    };
}

// 15. Phân tích cầu tổng hợp từ tất cả thuật toán
function analyzeUltimateEnsemble(history, patterns) {
    if (history.length < 10) {
        return {
            prediction: 'T',
            confidence: 50,
            reason: 'Chưa đủ dữ liệu (cần 10 phiên)',
            algos: 0,
            details: []
        };
    }
    
    const predictions = [];
    const algoResults = {};
    
    // Danh sách thuật toán
    const algos = [
        { name: 'SuperStreak', func: analyzeSuperStreak },
        { name: 'Alternating', func: analyzeAlternatingPattern },
        { name: 'Pattern22', func: analyzePattern22 },
        { name: 'Pattern33', func: analyzePattern33 },
        { name: 'SpecialPatterns', func: analyzeSpecialPatterns },
        { name: 'SuperBalance', func: analyzeSuperBalance },
        { name: 'ScoreDice', func: analyzeScoreAndDice },
        { name: 'SuperCycle', func: analyzeSuperCycle },
        { name: 'SuperFibonacci', func: analyzeSuperFibonacci },
        { name: 'LearnedPatterns', func: analyzeLearnedPatterns, params: [patterns] },
        { name: 'TechnicalIndicators', func: analyzeTechnicalIndicators },
        { name: 'ReversalPattern', func: analyzeReversalPattern },
        { name: 'Momentum', func: analyzeMomentum }
    ];
    
    // Chạy tất cả thuật toán
    for (const algo of algos) {
        try {
            const params = algo.params ? [history, ...algo.params] : [history];
            const result = algo.func(...params);
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
            algos: 0,
            details: []
        };
    }
    
    // Tính trọng số với model weights
    let tScore = 0, xScore = 0;
    let totalWeight = 0;
    let detailedResults = [];
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
    
    // Lấy top 3 lý do
    const topReasons = algoDetails.slice(0, 3).map(d => `${d.algo}: ${d.reason} (${d.confidence}%)`);
    
    // Điều chỉnh dựa trên độ tin cậy tổng thể
    const confidenceBonus = Math.min(10, Math.floor(predictions.length / 2));
    const finalPred = tScore > xScore ? 'T' : 'X';
    let finalConfidence = Math.round((Math.max(tScore, xScore) / totalWeight) * 100);
    finalConfidence = Math.min(95, Math.max(50, finalConfidence + confidenceBonus));
    
    // Lấy lý do từ thuật toán tốt nhất
    const bestAlgo = algoDetails[0];
    
    return {
        prediction: finalPred,
        confidence: finalConfidence,
        reason: bestAlgo ? bestAlgo.reason : 'Tổng hợp từ nhiều thuật toán',
        algos: predictions.length,
        details: topReasons,
        algoDetails: algoDetails.slice(0, 5),
        tScore: Math.round(tScore),
        xScore: Math.round(xScore),
        bestAlgo: bestAlgo ? bestAlgo.algo : 'N/A',
        bestAlgoConfidence: bestAlgo ? bestAlgo.confidence : 0
    };
}

// ==================== HÀM GỌI API ====================

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

// ==================== HÀM HIỂN THỊ ====================

function displayUltimateResult(type, history, prediction, phien) {
    console.clear();
    console.log('╔═══════════════════════════════════════════════════════════════════════════════════════╗');
    console.log(`║  🎲 HỆ THỐNG AI DỰ ĐOÁN XÚC XẮC ULTIMATE - ${USER_ID}`);
    console.log('╠═══════════════════════════════════════════════════════════════════════════════════════╣');
    console.log(`║  📊 Lịch sử ${history.length} phiên:`);
    
    // Hiển thị 20 phiên gần nhất với màu
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
    console.log(`║  🚀 PHIÊN HIỆN TẠI: ${phien}`);
    
    const predColor = prediction.prediction === 'T' ? '\x1b[33m' : '\x1b[36m';
    const predLabel = prediction.prediction === 'T' ? 'TÀI' : 'XỈU';
    console.log(`║  🎯 DỰ ĐOÁN: ${predColor}${predLabel}\x1b[0m`);
    console.log(`║  📈 TỈ LỆ: ${prediction.confidence}%`);
    console.log(`║  🧠 SỐ THUẬT TOÁN: ${prediction.algos}`);
    console.log(`║  🏆 THUẬT TOÁN TỐT NHẤT: ${prediction.bestAlgo || 'N/A'} (${prediction.bestAlgoConfidence || 0}%)`);
    console.log(`║  📝 LÝ DO: ${prediction.reason}`);
    console.log('╠═══════════════════════════════════════════════════════════════════════════════════════╣');
    console.log(`║  📊 ĐIỂM SỐ: TÀI=${prediction.tScore || 0} | XỈU=${prediction.xScore || 0}`);
    
    if (prediction.details && prediction.details.length > 0) {
        console.log('╠═══════════════════════════════════════════════════════════════════════════════════════╣');
        console.log('║  📋 TOP 3 THUẬT TOÁN:');
        for (const detail of prediction.details) {
            console.log(`║    - ${detail}`);
        }
    }
    
    if (prediction.algoDetails && prediction.algoDetails.length > 0) {
        console.log('╠═══════════════════════════════════════════════════════════════════════════════════════╣');
        console.log('║  🔬 CHI TIẾT TỪNG THUẬT TOÁN:');
        for (const detail of prediction.algoDetails) {
            const pred = detail.prediction === 'T' ? 'TÀI' : 'XỈU';
            const color = detail.prediction === 'T' ? '\x1b[33m' : '\x1b[36m';
            console.log(`║    ${detail.algo.padEnd(20)} ${color}${pred}\x1b[0m ${detail.confidence}% - ${detail.reason.substring(0, 40)}${detail.reason.length > 40 ? '...' : ''}`);
        }
    }
    
    // Thống kê
    const stats = state.stats || { total: 0, correct: 0, wrong: 0 };
    const rate = stats.total ? Math.round(stats.correct / stats.total * 100) : 0;
    console.log('╠═══════════════════════════════════════════════════════════════════════════════════════╣');
    console.log(`║  📊 THỐNG KÊ: Đúng ${stats.correct}/${stats.total} (${rate}%) | Thua ${stats.wrong} | Chuỗi ${state.stats?.streak || 0}`);
    console.log('╚═══════════════════════════════════════════════════════════════════════════════════════╝');
    
    // JSON Output
    console.log('\n📋 JSON OUTPUT:');
    const jsonOutput = {
        type: type,
        phien: phien,
        ket_qua: history[history.length - 1]?.result || 'N/A',
        du_doan: prediction.prediction === 'T' ? 'TÀI' : 'XỈU',
        ty_le: prediction.confidence + '%',
        so_thuat_toan: prediction.algos,
        thuat_toan_tot_nhat: prediction.bestAlgo || 'N/A',
        id: USER_ID
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
}

// ==================== HÀM CHÍNH ====================

async function main() {
    loadAllData();
    
    // Khởi tạo weights
    const defaultWeights = {
        'SuperStreak': 1.0,
        'Alternating': 1.0,
        'Pattern22': 1.0,
        'Pattern33': 1.0,
        'SpecialPatterns': 1.0,
        'SuperBalance': 1.0,
        'ScoreDice': 1.0,
        'SuperCycle': 1.0,
        'SuperFibonacci': 1.0,
        'LearnedPatterns': 1.0,
        'TechnicalIndicators': 1.0,
        'ReversalPattern': 1.0,
        'Momentum': 1.0
    };
    
    for (const key in defaultWeights) {
        if (!state.weights[key]) state.weights[key] = 1.0;
    }
    
    console.log('🚀 KHỞI ĐỘNG HỆ THỐNG AI DỰ ĐOÁN XÚC XẮC ULTIMATE');
    console.log(`📡 API 1: ${API_LC_HU}`);
    console.log(`📡 API 2: ${API_MD5}`);
    console.log('⏳ Đang chờ dữ liệu...\n');
    
    let lastPhien = null;
    let isReady = false;
    let learnCount = 0;
    
    setInterval(async () => {
        try {
            // Lấy dữ liệu từ cả 2 API
            const [data1, data2] = await Promise.all([
                fetchData(API_LC_HU),
                fetchData(API_MD5)
            ]);
            
            const sessions1 = parseSessions(data1);
            const sessions2 = parseSessions(data2);
            
            // Kết hợp dữ liệu
            let allSessions = [...sessions1, ...sessions2];
            allSessions.sort((a, b) => a.phien - b.phien);
            
            if (allSessions.length === 0) return;
            
            const latest = allSessions[allSessions.length - 1];
            
            // Chỉ xử lý phiên mới
            if (latest.phien === lastPhien) return;
            lastPhien = latest.phien;
            
            // Thêm vào lịch sử
            state.history.push(latest);
            if (state.history.length > 1000) state.history.shift();
            
            // Học patterns
            if (state.history.length >= 10) {
                state.patterns = learnAllPatterns(state.history);
                isReady = true;
                saveAllData();
            }
            
            // Dự đoán
            if (isReady) {
                const prediction = analyzeUltimateEnsemble(state.history, state.patterns);
                
                // Cập nhật thống kê
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
                
                displayUltimateResult('KẾT HỢP', state.history, prediction, latest.phien);
                
                console.log(`\n📊 THỐNG KÊ: Đúng ${state.stats.correct}/${state.stats.total} (${state.stats.total ? Math.round(state.stats.correct/state.stats.total*100) : 0}%) | Chuỗi: ${state.stats.streak || 0}`);
            } else {
                learnCount++;
                console.log(`[⏳] ĐANG HỌC CẦU... ${state.history.length}/10 phiên`);
            }
            
        } catch (e) {
            // Bỏ qua lỗi
        }
    }, 3000);
}

// ==================== HÀM HỌC PATTERNS ====================

function learnAllPatterns(history) {
    if (history.length < 10) return {};
    
    const patterns = {};
    const results = history.map(h => h.result);
    
    // Học từ độ dài 2 đến 12
    for (let len = 2; len <= 12; len++) {
        for (let i = 0; i <= results.length - len - 1; i++) {
            const pattern = results.slice(i, i + len).join('');
            const next = results[i + len];
            
            if (!patterns[pattern]) {
                patterns[pattern] = { T: 0, X: 0, total: 0, positions: [] };
            }
            patterns[pattern][next]++;
            patterns[pattern].total++;
            patterns[pattern].positions.push(i);
        }
    }
    
    // Tính xác suất cho từng pattern
    for (const key in patterns) {
        const data = patterns[key];
        data.taiProb = data.T / data.total;
        data.xiuProb = data.X / data.total;
        data.confidence = Math.abs(data.taiProb - data.xiuProb);
        data.strength = data.total / history.length;
    }
    
    return patterns;
}

// ==================== EXPORT ====================
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        analyzeSuperStreak,
        analyzeAlternatingPattern,
        analyzePattern22,
        analyzePattern33,
        analyzeSpecialPatterns,
        analyzeSuperBalance,
        analyzeScoreAndDice,
        analyzeSuperCycle,
        analyzeSuperFibonacci,
        analyzeLearnedPatterns,
        analyzeTechnicalIndicators,
        analyzeReversalPattern,
        analyzeMomentum,
        analyzeUltimateEnsemble,
        learnAllPatterns
    };
}

// ==================== KHỞI CHẠY ====================
main();
