const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'tranhoang.json';
const HISTORY_FILE = 'tranhoang1.json';

let predictionHistory = {
  hu: [],
  md5: []
};

const MAX_HISTORY = 200;
const AUTO_SAVE_INTERVAL = 15000;
let lastProcessedPhien = { hu: null, md5: null };

let learningData = {
  hu: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: []
  },
  md5: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: []
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.5,
  'cau_dao_11': 1.3,
  'cau_22': 1.4,
  'cau_33': 1.2,
  'cau_121': 1.3,
  'cau_123': 1.2,
  'cau_321': 1.2,
  'cau_nhay_coc': 1.1,
  'cau_nhip_nghieng': 1.3,
  'cau_3van1': 1.2,
  'cau_be_cau': 1.5,
  'cau_chu_ky': 1.3,
  'distribution': 1.2,
  'dice_pattern': 1.1,
  'sum_trend': 1.4,
  'edge_cases': 1.3,
  'momentum': 1.4,
  'cau_tu_nhien': 1.0,
  'dice_trend_line': 1.2,
  'dice_trend_line_md5': 1.2,
  'break_pattern_hu': 1.5,
  'break_pattern_md5': 1.5,
  'fibonacci': 1.3,
  'resistance_support': 1.2,
  'wave': 1.3,
  'golden_ratio': 1.4,
  'day_gay': 1.6,
  'day_gay_md5': 1.6,
  'cau_44': 1.3,
  'cau_55': 1.4,
  'cau_212': 1.3,
  'cau_1221': 1.3,
  'cau_2112': 1.3,
  'cau_gap': 1.4,
  'cau_ziczac': 1.3,
  'cau_doi': 1.4,
  'cau_rong': 1.6,
  'smart_bet': 1.5,
  'break_pattern_advanced': 1.5,
  'break_streak': 1.6,
  'alternating_break': 1.4,
  'double_pair_break': 1.5,
  'triple_pattern': 1.5,
  'tong_phan_tich': 1.8,
  'xu_huong_manh': 1.7,
  'dao_chieu': 1.6,
  'cao_thap': 1.5,
  'cau_keo': 1.4,
  'cau_day': 1.5,
  'cau_loi': 1.4,
  'cau_gay_khuc': 1.5,
  'cau_lap_lai': 1.4,
  'cau_dao_chieu_manh': 1.7,
  'cau_bet_keo': 1.5,
  'cau_xen_ke_manh': 1.4,
  'cau_3_day': 1.5,
  'cau_4_day': 1.6,
  'cau_5_day': 1.7,
  'cau_doi_xung': 1.4,
  'cau_phuc_hop': 1.5,
  'cau_du_bao': 1.6,
  'cau_bat_ngo': 1.5,
  'cau_thong_minh': 1.7
};

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      learningData = { ...learningData, ...parsed };
      console.log('Learning data loaded successfully from tranhoang.json');
    }
  } catch (error) {
    console.error('Error loading learning data:', error.message);
  }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('Error saving learning data:', error.message);
  }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      predictionHistory = parsed.history || { hu: [], md5: [] };
      lastProcessedPhien = parsed.lastProcessedPhien || { hu: null, md5: null };
      console.log('Prediction history loaded successfully from tranhoang1.json');
      console.log(`  - Hu: ${predictionHistory.hu.length} records`);
      console.log(`  - MD5: ${predictionHistory.md5.length} records`);
    }
  } catch (error) {
    console.error('Error loading prediction history:', error.message);
  }
}

function savePredictionHistory() {
  try {
    const dataToSave = {
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    };
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(dataToSave, null, 2));
  } catch (error) {
    console.error('Error saving prediction history:', error.message);
  }
}

async function autoProcessPredictions() {
  try {
    const dataHu = await fetchDataHu();
    if (dataHu && dataHu.length > 0) {
      const latestHuPhien = dataHu[0].Phien;
      const nextHuPhien = latestHuPhien + 1;
      
      if (lastProcessedPhien.hu !== nextHuPhien) {
        await verifyPredictions('hu', dataHu);
        
        const result = calculateSuperPrediction(dataHu, 'hu');
        savePredictionToHistory('hu', nextHuPhien, result.prediction, result.confidence, dataHu[0]);
        recordPrediction('hu', nextHuPhien, result.prediction, result.confidence, result.factors);
        
        lastProcessedPhien.hu = nextHuPhien;
        console.log(`[Auto] Hu phien ${nextHuPhien}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    
    const dataMd5 = await fetchDataMd5();
    if (dataMd5 && dataMd5.length > 0) {
      const latestMd5Phien = dataMd5[0].Phien;
      const nextMd5Phien = latestMd5Phien + 1;
      
      if (lastProcessedPhien.md5 !== nextMd5Phien) {
        await verifyPredictions('md5', dataMd5);
        
        const result = calculateSuperPrediction(dataMd5, 'md5');
        savePredictionToHistory('md5', nextMd5Phien, result.prediction, result.confidence, dataMd5[0]);
        recordPrediction('md5', nextMd5Phien, result.prediction, result.confidence, result.factors);
        
        lastProcessedPhien.md5 = nextMd5Phien;
        console.log(`[Auto] MD5 phien ${nextMd5Phien}: ${result.prediction} (${result.confidence}%)`);
      }
    }
    
    await updateHistoryStatus('hu');
    await updateHistoryStatus('md5');
    
    savePredictionHistory();
    saveLearningData();
    
  } catch (error) {
    console.error('[Auto] Error processing predictions:', error.message);
  }
}

async function updateHistoryStatus(type) {
  try {
    let data = null;
    if (type === 'hu') {
      data = await fetchDataHu();
    } else {
      data = await fetchDataMd5();
    }
    
    if (!data || data.length === 0) return;
    
    let updated = false;
    for (const record of predictionHistory[type]) {
      if (record.ket_qua_du_doan && record.ket_qua_du_doan !== '') continue;
      
      const actualResult = data.find(d => d.Phien.toString() === record.Phien_hien_tai);
      if (actualResult) {
        const duDoanNormalized = record.Du_doan;
        const ketQuaThucTe = actualResult.Ket_qua;
        
        if (duDoanNormalized === ketQuaThucTe) {
          record.ket_qua_du_doan = 'Đúng ✅';
        } else {
          record.ket_qua_du_doan = 'Sai ❌';
        }
        updated = true;
      }
    }
    
    if (updated) {
      savePredictionHistory();
    }
  } catch (error) {
    console.error(`Error updating ${type} history status:`, error.message);
  }
}

function startAutoSaveTask() {
  console.log(`Auto-save task started (every ${AUTO_SAVE_INTERVAL/1000}s)`);
  
  setTimeout(() => {
    autoProcessPredictions();
  }, 3000);
  
  setInterval(() => {
    autoProcessPredictions();
  }, AUTO_SAVE_INTERVAL);
}

function initializePatternStats(type) {
  if (!learningData[type].patternWeights || Object.keys(learningData[type].patternWeights).length === 0) {
    learningData[type].patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  }
  
  Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(pattern => {
    if (!learningData[type].patternStats[pattern]) {
      learningData[type].patternStats[pattern] = {
        total: 0,
        correct: 0,
        accuracy: 0.5,
        recentResults: [],
        lastAdjustment: null
      };
    }
  });
}

function getPatternWeight(type, patternId) {
  initializePatternStats(type);
  return learningData[type].patternWeights[patternId] || 1.0;
}

function updatePatternPerformance(type, patternId, isCorrect) {
  initializePatternStats(type);
  
  const stats = learningData[type].patternStats[patternId];
  if (!stats) return;
  
  stats.total++;
  if (isCorrect) stats.correct++;
  
  stats.recentResults.push(isCorrect ? 1 : 0);
  if (stats.recentResults.length > 30) {
    stats.recentResults.shift();
  }
  
  const recentAccuracy = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
  stats.accuracy = stats.total > 0 ? stats.correct / stats.total : 0.5;
  
  const oldWeight = learningData[type].patternWeights[patternId];
  let newWeight = oldWeight;
  
  if (stats.recentResults.length >= 10) {
    if (recentAccuracy > 0.65) {
      newWeight = Math.min(3.5, oldWeight * 1.15);
    } else if (recentAccuracy < 0.35) {
      newWeight = Math.max(0.3, oldWeight * 0.85);
    } else if (recentAccuracy > 0.55) {
      newWeight = Math.min(2.5, oldWeight * 1.05);
    }
  }
  
  learningData[type].patternWeights[patternId] = newWeight;
  stats.lastAdjustment = new Date().toISOString();
}

function recordPrediction(type, phien, prediction, confidence, patterns) {
  const record = {
    phien: phien.toString(),
    prediction,
    confidence,
    patterns,
    timestamp: new Date().toISOString(),
    verified: false,
    actual: null,
    isCorrect: null
  };
  
  learningData[type].predictions.unshift(record);
  learningData[type].totalPredictions++;
  
  if (learningData[type].predictions.length > 800) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 800);
  }
  
  saveLearningData();
}

async function verifyPredictions(type, currentData) {
  let updated = false;
  
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    
    const actualResult = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actualResult) {
      pred.verified = true;
      pred.actual = actualResult.Ket_qua;
      
      const predictedNormalized = pred.prediction === 'Tài' || pred.prediction === 'tai' ? 'Tài' : 'Xỉu';
      pred.isCorrect = pred.actual === predictedNormalized;
      
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.wins++;
        
        if (learningData[type].streakAnalysis.currentStreak >= 0) {
          learningData[type].streakAnalysis.currentStreak++;
        } else {
          learningData[type].streakAnalysis.currentStreak = 1;
        }
        
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
      } else {
        learningData[type].streakAnalysis.losses++;
        
        if (learningData[type].streakAnalysis.currentStreak <= 0) {
          learningData[type].streakAnalysis.currentStreak--;
        } else {
          learningData[type].streakAnalysis.currentStreak = -1;
        }
        
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
      }
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 80) {
        learningData[type].recentAccuracy.shift();
      }
      
      if (pred.patterns && pred.patterns.length > 0) {
        pred.patterns.forEach(patternName => {
          const patternId = getPatternIdFromName(patternName);
          if (patternId) {
            updatePatternPerformance(type, patternId, pred.isCorrect);
          }
        });
      }
      
      updated = true;
    }
  }
  
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
  }
}

function getPatternIdFromName(name) {
  const mapping = {
    'Cầu Bệt': 'cau_bet',
    'Cầu Đảo 1-1': 'cau_dao_11',
    'Cầu 2-2': 'cau_22',
    'Cầu 3-3': 'cau_33',
    'Cầu 4-4': 'cau_44',
    'Cầu 5-5': 'cau_55',
    'Cầu 1-2-1': 'cau_121',
    'Cầu 1-2-3': 'cau_123',
    'Cầu 3-2-1': 'cau_321',
    'Cầu 2-1-2': 'cau_212',
    'Cầu 1-2-2-1': 'cau_1221',
    'Cầu 2-1-1-2': 'cau_2112',
    'Cầu Nhảy Cóc': 'cau_nhay_coc',
    'Cầu Nhịp Nghiêng': 'cau_nhip_nghieng',
    'Cầu 3 Ván 1': 'cau_3van1',
    'Cầu Bẻ Cầu': 'cau_be_cau',
    'Cầu Chu Kỳ': 'cau_chu_ky',
    'Cầu Gấp': 'cau_gap',
    'Cầu Ziczac': 'cau_ziczac',
    'Cầu Đôi': 'cau_doi',
    'Cầu Rồng': 'cau_rong',
    'Đảo Xu Hướng': 'smart_bet',
    'Xu Hướng Cực': 'smart_bet',
    'Phân bố': 'distribution',
    'Tổng TB': 'dice_pattern',
    'Xu hướng': 'sum_trend',
    'Cực Điểm': 'edge_cases',
    'Biến động': 'momentum',
    'Cầu Tự Nhiên': 'cau_tu_nhien',
    'Biểu Đồ Đường': 'dice_trend_line',
    'MD5 Biểu Đồ': 'dice_trend_line_md5',
    'Cầu Liên Tục': 'break_pattern_hu',
    'MD5 Cầu': 'break_pattern_md5',
    'Dây Gãy': 'day_gay',
    'MD5 Dây Gãy': 'day_gay_md5',
    'Tổng Phân Tích': 'tong_phan_tich',
    'Xu Hướng Mạnh': 'xu_huong_manh',
    'Đảo Chiều': 'dao_chieu',
    'Cao Thấp': 'cao_thap',
    'Cầu Kéo': 'cau_keo',
    'Cầu Đẩy': 'cau_day',
    'Cầu Lỡi': 'cau_loi',
    'Cầu Gãy Khúc': 'cau_gay_khuc',
    'Cầu Lặp Lại': 'cau_lap_lai',
    'Đảo Chiều Mạnh': 'cau_dao_chieu_manh',
    'Bệt Kéo': 'cau_bet_keo',
    'Xen Kẽ Mạnh': 'cau_xen_ke_manh',
    '3 Đẩy': 'cau_3_day',
    '4 Đẩy': 'cau_4_day',
    '5 Đẩy': 'cau_5_day',
    'Đối Xứng': 'cau_doi_xung',
    'Phức Hợp': 'cau_phuc_hop',
    'Dự Báo': 'cau_du_bao',
    'Bất Ngờ': 'cau_bat_ngo',
    'Thông Minh': 'cau_thong_minh'
  };
  
  for (const [key, value] of Object.entries(mapping)) {
    if (name.includes(key)) return value;
  }
  return null;
}

function getAdaptiveConfidenceBoost(type) {
  const recentAcc = learningData[type].recentAccuracy;
  if (recentAcc.length < 15) return 0;
  
  const accuracy = recentAcc.reduce((a, b) => a + b, 0) / recentAcc.length;
  
  if (accuracy > 0.70) return 12;
  if (accuracy > 0.60) return 8;
  if (accuracy > 0.50) return 4;
  if (accuracy < 0.30) return -12;
  if (accuracy < 0.40) return -8;
  
  return 0;
}

function getSmartPredictionAdjustment(type, prediction, patterns) {
  const streakInfo = learningData[type].streakAnalysis;
  
  if (streakInfo.currentStreak <= -5) {
    return prediction === 'Tài' ? 'Xỉu' : 'Tài';
  }
  
  let taiPatternScore = 0;
  let xiuPatternScore = 0;
  
  patterns.forEach(p => {
    const patternId = getPatternIdFromName(p.name || p);
    if (patternId) {
      const stats = learningData[type].patternStats[patternId];
      if (stats && stats.recentResults.length >= 10) {
        const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
        const weight = learningData[type].patternWeights[patternId] || 1;
        
        if (p.prediction === 'Tài') {
          taiPatternScore += recentAcc * weight;
        } else {
          xiuPatternScore += recentAcc * weight;
        }
      }
    }
  });
  
  if (Math.abs(taiPatternScore - xiuPatternScore) > 0.8) {
    return taiPatternScore > xiuPatternScore ? 'Tài' : 'Xỉu';
  }
  
  return prediction;
}

function transformApiData(apiData) {
  if (!apiData || !apiData.list || !Array.isArray(apiData.list)) {
    return null;
  }
  
  return apiData.list.map(item => {
    const result = item.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu';
    return {
      Phien: item.id,
      Ket_qua: result,
      Xuc_xac_1: item.dices[0],
      Xuc_xac_2: item.dices[1],
      Xuc_xac_3: item.dices[2],
      Tong: item.point
    };
  });
}

async function fetchDataHu() {
  try {
    const response = await axios.get(API_URL_HU, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('Error fetching HU data:', error.message);
    return null;
  }
}

async function fetchDataMd5() {
  try {
    const response = await axios.get(API_URL_MD5, { timeout: 10000 });
    return transformApiData(response.data);
  } catch (error) {
    console.error('Error fetching MD5 data:', error.message);
    return null;
  }
}

// ==================== THUẬT TOÁN SIÊU MẠNH ====================

function analyzeCaoThap(data, type) {
  if (data.length < 8) return { detected: false };
  
  const recent8 = data.slice(0, 8);
  const results = recent8.map(d => d.Ket_qua);
  const scores = recent8.map(d => d.Tong);
  
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const lastScore = scores[0];
  
  const weight = getPatternWeight(type, 'cao_thap');
  
  if (lastScore > avgScore + 3) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(70 + (lastScore - avgScore) * 2),
      name: `Cao Thấp (${lastScore} > ${avgScore.toFixed(1)}) → Xỉu`,
      patternId: 'cao_thap'
    };
  }
  
  if (lastScore < avgScore - 3) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(70 + (avgScore - lastScore) * 2),
      name: `Cao Thấp (${lastScore} < ${avgScore.toFixed(1)}) → Tài`,
      patternId: 'cao_thap'
    };
  }
  
  return { detected: false };
}

function analyzeCauKeo(data, type) {
  if (data.length < 6) return { detected: false };
  
  const results = data.slice(0, 6).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_keo');
  
  let taiCount = results.filter(r => r === 'Tài').length;
  
  if (taiCount >= 4 && taiCount <= 5) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(75 + (taiCount - 4) * 5),
      name: `Cầu Kéo (${taiCount}T-${6-taiCount}X) → Xỉu`,
      patternId: 'cau_keo'
    };
  }
  
  if (taiCount <= 2 && taiCount >= 1) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(75 + (2 - taiCount) * 5),
      name: `Cầu Kéo (${6-taiCount}X-${taiCount}T) → Tài`,
      patternId: 'cau_keo'
    };
  }
  
  return { detected: false };
}

function analyzeCauDay(data, type) {
  if (data.length < 4) return { detected: false };
  
  const results = data.slice(0, 4).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_day');
  
  const taiCount = results.filter(r => r === 'Tài').length;
  
  if (taiCount === 3) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 72,
      name: `Cầu Đẩy (3T-1X) → Xỉu`,
      patternId: 'cau_day'
    };
  }
  
  if (taiCount === 1) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 72,
      name: `Cầu Đẩy (3X-1T) → Tài`,
      patternId: 'cau_day'
    };
  }
  
  return { detected: false };
}

function analyzeCauLoi(data, type) {
  if (data.length < 5) return { detected: false };
  
  const results = data.slice(0, 5).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_loi');
  
  let taiCount = results.filter(r => r === 'Tài').length;
  
  if (taiCount === 4) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 78,
      name: `Cầu Lỡi (4T-1X) → Xỉu mạnh`,
      patternId: 'cau_loi'
    };
  }
  
  if (taiCount === 1) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 78,
      name: `Cầu Lỡi (4X-1T) → Tài mạnh`,
      patternId: 'cau_loi'
    };
  }
  
  return { detected: false };
}

function analyzeCauGayKhuc(data, type) {
  if (data.length < 7) return { detected: false };
  
  const results = data.slice(0, 7).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_gay_khuc');
  
  let changes = 0;
  for (let i = 1; i < results.length; i++) {
    if (results[i] !== results[i-1]) changes++;
  }
  
  if (changes >= 5) {
    const lastResult = results[0];
    return {
      detected: true,
      prediction: lastResult === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(72 + changes * 2),
      name: `Cầu Gãy Khúc (${changes} lần đổi) → ${lastResult === 'Tài' ? 'Xỉu' : 'Tài'}`,
      patternId: 'cau_gay_khuc'
    };
  }
  
  return { detected: false };
}

function analyzeCauLapLai(data, type) {
  if (data.length < 6) return { detected: false };
  
  const results = data.slice(0, 6).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_lap_lai');
  
  const pattern = results.join('-');
  
  if (pattern === 'Tài-Xỉu-Tài-Xỉu-Tài-Xỉu' || pattern === 'Xỉu-Tài-Xỉu-Tài-Xỉu-Tài') {
    return {
      detected: true,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 80,
      name: `Cầu Lặp Lại (${pattern}) → ${results[0] === 'Tài' ? 'Xỉu' : 'Tài'}`,
      patternId: 'cau_lap_lai'
    };
  }
  
  return { detected: false };
}

function analyzeCauDaoChieuManh(data, type) {
  if (data.length < 8) return { detected: false };
  
  const results = data.slice(0, 8).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_dao_chieu_manh');
  
  const first4 = results.slice(0, 4);
  const last4 = results.slice(4, 8);
  
  const taiFirst4 = first4.filter(r => r === 'Tài').length;
  const taiLast4 = last4.filter(r => r === 'Tài').length;
  
  if ((taiFirst4 >= 3 && taiLast4 <= 1) || (taiFirst4 <= 1 && taiLast4 >= 3)) {
    const prediction = taiLast4 >= 3 ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: 78,
      name: `Đảo Chiều Mạnh (${taiFirst4}T-${4-taiFirst4}X → ${taiLast4}T-${4-taiLast4}X)`,
      patternId: 'cau_dao_chieu_manh'
    };
  }
  
  return { detected: false };
}

function analyzeCauBetKeo(data, type) {
  if (data.length < 5) return { detected: false };
  
  const results = data.slice(0, 5).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_bet_keo');
  
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 3) {
    const shouldBreak = streakLength >= 4;
    const confidence = shouldBreak ? 78 + streakLength * 2 : 65 + streakLength * 3;
    
    return {
      detected: true,
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence: Math.round(Math.min(92, confidence) * weight),
      name: `Bệt Kéo ${streakLength} phiên ${streakType} → ${shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType}`,
      patternId: 'cau_bet_keo'
    };
  }
  
  return { detected: false };
}

function analyzeCauXenKeManh(data, type) {
  if (data.length < 8) return { detected: false };
  
  const results = data.slice(0, 8).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_xen_ke_manh');
  
  let alternating = 0;
  for (let i = 1; i < results.length; i++) {
    if (results[i] !== results[i-1]) alternating++;
  }
  
  if (alternating >= 6) {
    const lastResult = results[0];
    return {
      detected: true,
      prediction: lastResult === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(75 + alternating * 2),
      name: `Xen Kẽ Mạnh (${alternating}/7 lần đổi) → ${lastResult === 'Tài' ? 'Xỉu' : 'Tài'}`,
      patternId: 'cau_xen_ke_manh'
    };
  }
  
  return { detected: false };
}

function analyzeCau3Day(data, type) {
  if (data.length < 6) return { detected: false };
  
  const results = data.slice(0, 6).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_3_day');
  
  const first3 = results.slice(0, 3);
  const last3 = results.slice(3, 6);
  
  const taiFirst3 = first3.filter(r => r === 'Tài').length;
  const taiLast3 = last3.filter(r => r === 'Tài').length;
  
  if (taiFirst3 === 3 && taiLast3 <= 1) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 80,
      name: `3 Đẩy (3T → ${taiLast3}T-${3-taiLast3}X) → Xỉu`,
      patternId: 'cau_3_day'
    };
  }
  
  if (taiFirst3 === 0 && taiLast3 >= 2) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 80,
      name: `3 Đẩy (3X → ${taiLast3}T-${3-taiLast3}X) → Tài`,
      patternId: 'cau_3_day'
    };
  }
  
  return { detected: false };
}

function analyzeCau4Day(data, type) {
  if (data.length < 8) return { detected: false };
  
  const results = data.slice(0, 8).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_4_day');
  
  const first4 = results.slice(0, 4);
  const last4 = results.slice(4, 8);
  
  const taiFirst4 = first4.filter(r => r === 'Tài').length;
  const taiLast4 = last4.filter(r => r === 'Tài').length;
  
  if (taiFirst4 >= 3 && taiLast4 <= 1) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 82,
      name: `4 Đẩy (${taiFirst4}T-${4-taiFirst4}X → ${taiLast4}T-${4-taiLast4}X) → Xỉu`,
      patternId: 'cau_4_day'
    };
  }
  
  if (taiFirst4 <= 1 && taiLast4 >= 3) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 82,
      name: `4 Đẩy (${taiFirst4}T-${4-taiFirst4}X → ${taiLast4}T-${4-taiLast4}X) → Tài`,
      patternId: 'cau_4_day'
    };
  }
  
  return { detected: false };
}

function analyzeCau5Day(data, type) {
  if (data.length < 10) return { detected: false };
  
  const results = data.slice(0, 10).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_5_day');
  
  const first5 = results.slice(0, 5);
  const last5 = results.slice(5, 10);
  
  const taiFirst5 = first5.filter(r => r === 'Tài').length;
  const taiLast5 = last5.filter(r => r === 'Tài').length;
  
  if (taiFirst5 >= 4 && taiLast5 <= 1) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 85,
      name: `5 Đẩy (${taiFirst5}T-${5-taiFirst5}X → ${taiLast5}T-${5-taiLast5}X) → Xỉu`,
      patternId: 'cau_5_day'
    };
  }
  
  if (taiFirst5 <= 1 && taiLast5 >= 4) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 85,
      name: `5 Đẩy (${taiFirst5}T-${5-taiFirst5}X → ${taiLast5}T-${5-taiLast5}X) → Tài`,
      patternId: 'cau_5_day'
    };
  }
  
  return { detected: false };
}

function analyzeCauDoiXung(data, type) {
  if (data.length < 6) return { detected: false };
  
  const results = data.slice(0, 6).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_doi_xung');
  
  if (results[0] === results[5] && results[1] === results[4] && results[2] === results[3]) {
    return {
      detected: true,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: 78,
      name: `Cầu Đối Xứng (${results.join('-')}) → ${results[0] === 'Tài' ? 'Xỉu' : 'Tài'}`,
      patternId: 'cau_doi_xung'
    };
  }
  
  return { detected: false };
}

function analyzeCauPhucHop(data, type) {
  if (data.length < 10) return { detected: false };
  
  const results = data.slice(0, 10).map(d => d.Ket_qua);
  const scores = data.slice(0, 10).map(d => d.Tong);
  const weight = getPatternWeight(type, 'cau_phuc_hop');
  
  const taiCount = results.filter(r => r === 'Tài').length;
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const lastScore = scores[0];
  
  if (taiCount >= 6 && lastScore > avgScore) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 84,
      name: `Cầu Phức Hợp (${taiCount}T-${10-taiCount}X, Score ${lastScore}) → Xỉu`,
      patternId: 'cau_phuc_hop'
    };
  }
  
  if (taiCount <= 4 && lastScore < avgScore) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 84,
      name: `Cầu Phức Hợp (${taiCount}T-${10-taiCount}X, Score ${lastScore}) → Tài`,
      patternId: 'cau_phuc_hop'
    };
  }
  
  return { detected: false };
}

function analyzeCauDuBao(data, type) {
  if (data.length < 12) return { detected: false };
  
  const results = data.slice(0, 12).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_du_bao');
  
  const first6 = results.slice(0, 6);
  const last6 = results.slice(6, 12);
  
  const taiFirst6 = first6.filter(r => r === 'Tài').length;
  const taiLast6 = last6.filter(r => r === 'Tài').length;
  
  if (taiFirst6 >= 4 && taiLast6 >= 4) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 86,
      name: `Cầu Dự Báo (${taiFirst6}T-${6-taiFirst6}X → ${taiLast6}T-${6-taiLast6}X) → Xỉu`,
      patternId: 'cau_du_bao'
    };
  }
  
  if (taiFirst6 <= 2 && taiLast6 <= 2) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 86,
      name: `Cầu Dự Báo (${taiFirst6}T-${6-taiFirst6}X → ${taiLast6}T-${6-taiLast6}X) → Tài`,
      patternId: 'cau_du_bao'
    };
  }
  
  return { detected: false };
}

function analyzeCauBatNgo(data, type) {
  if (data.length < 6) return { detected: false };
  
  const results = data.slice(0, 6).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_bat_ngo');
  
  const first4 = results.slice(0, 4);
  const taiFirst4 = first4.filter(r => r === 'Tài').length;
  
  if (taiFirst4 === 2) {
    return {
      detected: true,
      prediction: results[0],
      confidence: 70,
      name: `Cầu Bất Ngờ (Cân bằng) → ${results[0]}`,
      patternId: 'cau_bat_ngo'
    };
  }
  
  return { detected: false };
}

function analyzeCauThongMinh(data, type) {
  if (data.length < 8) return { detected: false };
  
  const results = data.slice(0, 8).map(d => d.Ket_qua);
  const scores = data.slice(0, 8).map(d => d.Tong);
  const weight = getPatternWeight(type, 'cau_thong_minh');
  
  const taiCount = results.filter(r => r === 'Tài').length;
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
  const lastScore = scores[0];
  
  if (taiCount === 4 && lastScore > avgScore + 2) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: 80,
      name: `Cầu Thông Minh (4T-4X, Score cao) → Xỉu`,
      patternId: 'cau_thong_minh'
    };
  }
  
  if (taiCount === 4 && lastScore < avgScore - 2) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: 80,
      name: `Cầu Thông Minh (4T-4X, Score thấp) → Tài`,
      patternId: 'cau_thong_minh'
    };
  }
  
  return { detected: false };
}

function analyzeCauRong(data, type) {
  if (data.length < 6) return { detected: false };
  
  const results = data.slice(0, 6).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_rong');
  
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 5) {
    return {
      detected: true,
      prediction: streakType === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(85 + streakLength * 2),
      name: `Cầu Rồng ${streakLength} phiên (Bẻ mạnh)`,
      patternId: 'cau_rong'
    };
  }
  
  return { detected: false };
}

function analyzeCauBet(data, type) {
  if (data.length < 3) return { detected: false };
  
  const results = data.slice(0, 10).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_bet');
  
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 3) {
    let shouldBreak = streakLength >= 5;
    let confidence = 65;
    
    if (streakLength >= 8) {
      shouldBreak = true;
      confidence = 92;
    } else if (streakLength >= 6) {
      shouldBreak = true;
      confidence = 85;
    } else if (streakLength >= 4) {
      shouldBreak = true;
      confidence = 75;
    } else {
      confidence = 68;
    }
    
    return {
      detected: true,
      type: streakType,
      length: streakLength,
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence: Math.round(confidence * weight),
      name: `Cầu Bệt ${streakLength} phiên ${streakType}`,
      patternId: 'cau_bet'
    };
  }
  
  return { detected: false };
}

function analyzeCauDao11(data, type) {
  if (data.length < 4) return { detected: false };
  
  const results = data.slice(0, 10).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_dao_11');
  
  let alternatingLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] !== results[i - 1]) {
      alternatingLength++;
    } else {
      break;
    }
  }
  
  if (alternatingLength >= 4) {
    const confidence = Math.min(85, 65 + alternatingLength * 3);
    
    return {
      detected: true,
      length: alternatingLength,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(confidence * weight),
      name: `Cầu Đảo 1-1 (${alternatingLength} phiên)`,
      patternId: 'cau_dao_11'
    };
  }
  
  return { detected: false };
}

function analyzeCau22(data, type) {
  if (data.length < 6) return { detected: false };
  
  const results = data.slice(0, 10).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_22');
  
  let pairCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 1 && pairCount < 4) {
    if (results[i] === results[i + 1]) {
      pattern.push(results[i]);
      pairCount++;
      i += 2;
    } else {
      break;
    }
  }
  
  if (pairCount >= 2) {
    let isAlternating = true;
    for (let j = 1; j < pattern.length; j++) {
      if (pattern[j] === pattern[j - 1]) {
        isAlternating = false;
        break;
      }
    }
    
    if (isAlternating) {
      const lastPairType = pattern[pattern.length - 1];
      
      return {
        detected: true,
        pairCount,
        prediction: lastPairType === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(Math.min(82, 65 + pairCount * 4) * weight),
        name: `Cầu 2-2 (${pairCount} cặp)`,
        patternId: 'cau_22'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCau33(data, type) {
  if (data.length < 6) return { detected: false };
  
  const results = data.slice(0, 10).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_33');
  
  let tripleCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 2) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pattern.push(results[i]);
      tripleCount++;
      i += 3;
    } else {
      break;
    }
  }
  
  if (tripleCount >= 1) {
    const currentPosition = results.length % 3;
    const lastTripleType = pattern[pattern.length - 1];
    
    let prediction;
    if (currentPosition === 0) {
      prediction = lastTripleType === 'Tài' ? 'Xỉu' : 'Tài';
    } else {
      prediction = lastTripleType;
    }
    
    return {
      detected: true,
      tripleCount,
      prediction,
      confidence: Math.round(Math.min(82, 68 + tripleCount * 5) * weight),
      name: `Cầu 3-3 (${tripleCount} bộ ba)`,
      patternId: 'cau_33'
    };
  }
  
  return { detected: false };
}

function analyzeCau121(data, type) {
  if (data.length < 4) return { detected: false };
  
  const results = data.slice(0, 6).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_121');
  
  const pattern1 = results.slice(0, 4);
  
  if (pattern1[0] !== pattern1[1] &&
    pattern1[1] === pattern1[2] &&
    pattern1[2] !== pattern1[3] &&
    pattern1[0] === pattern1[3]) {
    return {
      detected: true,
      pattern: '1-2-1',
      prediction: pattern1[0],
      confidence: Math.round(74 * weight),
      name: 'Cầu 1-2-1',
      patternId: 'cau_121'
    };
  }
  
  return { detected: false };
}

function analyzeCau123(data, type) {
  if (data.length < 6) return { detected: false };
  
  const results = data.slice(0, 6).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_123');
  
  const first = results[5];
  const nextTwo = results.slice(3, 5);
  const lastThree = results.slice(0, 3);
  
  if (nextTwo[0] === nextTwo[1] && nextTwo[0] !== first) {
    const allSame = lastThree.every(r => r === lastThree[0]);
    if (allSame && lastThree[0] !== nextTwo[0]) {
      return {
        detected: true,
        pattern: '1-2-3',
        prediction: first,
        confidence: Math.round(76 * weight),
        name: 'Cầu 1-2-3',
        patternId: 'cau_123'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCau321(data, type) {
  if (data.length < 6) return { detected: false };
  
  const results = data.slice(0, 6).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_321');
  
  const first3 = results.slice(3, 6);
  const next2 = results.slice(1, 3);
  const last1 = results[0];
  
  const first3Same = first3.every(r => r === first3[0]);
  const next2Same = next2.every(r => r === next2[0]);
  
  if (first3Same && next2Same && first3[0] !== next2[0] && last1 !== next2[0]) {
    return {
      detected: true,
      pattern: '3-2-1',
      prediction: next2[0],
      confidence: Math.round(78 * weight),
      name: 'Cầu 3-2-1',
      patternId: 'cau_321'
    };
  }
  
  return { detected: false };
}

function analyzeCauNhayCoc(data, type) {
  if (data.length < 6) return { detected: false };
  
  const results = data.slice(0, 10).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'cau_nhay_coc');
  
  const skipPattern = [];
  for (let i = 0; i < Math.min(results.length, 12); i += 2) {
    skipPattern.push(results[i]);
  }
  
  if (skipPattern.length >= 3) {
    const allSame = skipPattern.slice(0, 3).every(r => r === skipPattern[0]);
    if (allSame) {
      return {
        detected: true,
        pattern: skipPattern.slice(0, 3),
        prediction: skipPattern[0],
        confidence: Math.round(70 * weight),
        name: 'Cầu Nhảy Cóc',
        patternId: 'cau_nhay_coc'
      };
    }
    
    let alternating = true;
    for (let i = 1; i < skipPattern.length - 1; i++) {
      if (skipPattern[i] === skipPattern[i - 1]) {
        alternating = false;
        break;
      }
    }
    
    if (alternating && skipPattern.length >= 3) {
      return {
        detected: true,
        pattern: skipPattern.slice(0, 3),
        prediction: skipPattern[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(68 * weight),
        name: 'Cầu Nhảy Cóc Đảo',
        patternId: 'cau_nhay_coc'
      };
    }
  }
  
  return { detected: false };
}

function analyzeTongPhanTich(data, type) {
  if (data.length < 10) return { detected: false };
  
  const recent10 = data.slice(0, 10);
  const sums = recent10.map(d => d.Tong);
  const results = recent10.map(d => d.Ket_qua);
  
  const avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
  const taiCount = results.filter(r => r === 'Tài').length;
  const xiuCount = results.filter(r => r === 'Xỉu').length;
  
  const first5Sum = sums.slice(5, 10).reduce((a, b) => a + b, 0) / 5;
  const last5Sum = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const sumTrend = last5Sum - first5Sum;
  
  const weight = getPatternWeight(type, 'tong_phan_tich');
  
  if (sumTrend > 1.5) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(78 + Math.abs(sumTrend) * 4),
      name: `Tổng Phân Tích (Tổng tăng ${sumTrend.toFixed(1)} → Xỉu)`,
      patternId: 'tong_phan_tich'
    };
  }
  
  if (sumTrend < -1.5) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(78 + Math.abs(sumTrend) * 4),
      name: `Tổng Phân Tích (Tổng giảm ${Math.abs(sumTrend).toFixed(1)} → Tài)`,
      patternId: 'tong_phan_tich'
    };
  }
  
  if (Math.abs(taiCount - xiuCount) >= 3) {
    const lech = taiCount > xiuCount ? 'Tài' : 'Xỉu';
    const prediction = lech === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(72 + Math.abs(taiCount - xiuCount) * 4),
      name: `Tổng Phân Tích (Lệch ${Math.abs(taiCount - xiuCount)} về ${lech} → ${prediction})`,
      patternId: 'tong_phan_tich'
    };
  }
  
  return { detected: false };
}

function analyzeXuHuongManh(data, type) {
  if (data.length < 8) return { detected: false };
  
  const results = data.slice(0, 8).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'xu_huong_manh');
  
  const taiCount = results.filter(r => r === 'Tài').length;
  
  if (taiCount >= 6) {
    return {
      detected: true,
      prediction: 'Xỉu',
      confidence: Math.round(82 + taiCount * 2),
      name: `Xu Hướng Mạnh (${taiCount}/8 Tài → Đảo Xỉu)`,
      patternId: 'xu_huong_manh'
    };
  }
  
  if (taiCount <= 2) {
    return {
      detected: true,
      prediction: 'Tài',
      confidence: Math.round(82 + (8 - taiCount) * 2),
      name: `Xu Hướng Mạnh (${8 - taiCount}/8 Xỉu → Đảo Tài)`,
      patternId: 'xu_huong_manh'
    };
  }
  
  return { detected: false };
}

function analyzeDaoChieu(data, type) {
  if (data.length < 5) return { detected: false };
  
  const results = data.slice(0, 5).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'dao_chieu');
  
  let isAlternating = true;
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i] === results[i + 1]) {
      isAlternating = false;
      break;
    }
  }
  
  if (isAlternating) {
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: 78,
      name: `Đảo Chiều (Chuỗi ${results.join('-')} → ${prediction})`,
      patternId: 'dao_chieu'
    };
  }
  
  return { detected: false };
}

function analyzeBreakStreak(data, type) {
  if (data.length < 5) return { detected: false };
  
  const results = data.slice(0, 10).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'break_streak') || 1.0;
  
  let streakType = results[0];
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 4) {
    const prediction = streakType === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(Math.min(88, 72 + streakLength * 3) * weight),
      name: `Bẻ Chuỗi ${streakLength} (${streakType} → ${prediction})`,
      patternId: 'break_streak'
    };
  }
  
  return { detected: false };
}

function analyzeAlternatingBreak(data, type) {
  if (data.length < 6) return { detected: false };
  
  const results = data.slice(0, 10).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'alternating_break') || 1.0;
  
  let alternatingCount = 0;
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i] !== results[i + 1]) {
      alternatingCount++;
    } else {
      break;
    }
  }
  
  if (alternatingCount >= 6) {
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      prediction,
      confidence: Math.round(Math.min(84, 70 + alternatingCount * 2) * weight),
      name: `Bẻ Đảo ${alternatingCount} phiên → ${prediction}`,
      patternId: 'alternating_break'
    };
  }
  
  return { detected: false };
}

function analyzeDoublePairBreak(data, type) {
  if (data.length < 8) return { detected: false };
  
  const results = data.slice(0, 8).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'double_pair_break') || 1.0;
  
  const isPair1 = results[0] === results[1];
  const isPair2 = results[2] === results[3];
  const isPair3 = results[4] === results[5];
  const isPair4 = results[6] === results[7];
  
  if (isPair1 && isPair2 && isPair3 && isPair4) {
    const pairType1 = results[0];
    const pairType2 = results[2];
    
    const allSamePair = pairType1 === pairType2 && pairType2 === results[4] && results[4] === results[6];
    if (allSamePair) {
      const prediction = pairType1 === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: Math.round(86 * weight),
        name: `4 Cặp Cùng ${pairType1} → Bẻ ${prediction}`,
        patternId: 'double_pair_break'
      };
    }
    
    const alternatingPairs = pairType1 !== pairType2 && pairType2 !== results[4] && results[4] !== results[6];
    if (alternatingPairs) {
      const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: Math.round(80 * weight),
        name: `Cặp Đảo Xen Kẽ → Bẻ ${prediction}`,
        patternId: 'double_pair_break'
      };
    }
  }
  
  return { detected: false };
}

function analyzeTriplePattern(data, type) {
  if (data.length < 9) return { detected: false };
  
  const results = data.slice(0, 9).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'triple_pattern') || 1.0;
  
  const isTriple1 = results[0] === results[1] && results[1] === results[2];
  const isTriple2 = results[3] === results[4] && results[4] === results[5];
  const isTriple3 = results[6] === results[7] && results[7] === results[8];
  
  if (isTriple1 && isTriple2 && isTriple3) {
    const tripleType1 = results[0];
    const tripleType2 = results[3];
    const tripleType3 = results[6];
    
    if (tripleType1 === tripleType2 && tripleType2 === tripleType3) {
      const prediction = tripleType1 === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        prediction,
        confidence: Math.round(90 * weight),
        name: `3 Bộ Ba Cùng ${tripleType1} → Bẻ ${prediction}`,
        patternId: 'triple_pattern'
      };
    }
    
    if (tripleType1 !== tripleType2 && tripleType2 !== tripleType3) {
      const prediction = tripleType1;
      return {
        detected: true,
        prediction,
        confidence: Math.round(82 * weight),
        name: `Bộ Ba Đảo → Theo ${prediction}`,
        patternId: 'triple_pattern'
      };
    }
  }
  
  return { detected: false };
}

function analyzeSmartBet(data, type) {
  if (data.length < 10) return { detected: false };
  
  const results = data.slice(0, 10).map(d => d.Ket_qua);
  const weight = getPatternWeight(type, 'smart_bet');
  
  const last5 = results.slice(0, 5);
  const prev5 = results.slice(5, 10);
  
  const taiLast5 = last5.filter(r => r === 'Tài').length;
  const taiPrev5 = prev5.filter(r => r === 'Tài').length;
  
  const trendChanging = (taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4);
  
  if (trendChanging) {
    const currentDominant = taiLast5 >= 4 ? 'Tài' : 'Xỉu';
    return {
      detected: true,
      prediction: currentDominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(80 * weight),
      name: `Đảo Xu Hướng (${taiLast5}T-${5-taiLast5}X → ${taiPrev5}T-${5-taiPrev5}X)`,
      patternId: 'smart_bet'
    };
  }
  
  const taiLast10 = results.filter(r => r === 'Tài').length;
  if (taiLast10 >= 8 || taiLast10 <= 2) {
    const dominant = taiLast10 >= 8 ? 'Tài' : 'Xỉu';
    return {
      detected: true,
      prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(84 * weight),
      name: `Xu Hướng Cực (${taiLast10}T-${10-taiLast10}X) → Đảo`,
      patternId: 'smart_bet'
    };
  }
  
  return { detected: false };
}

function analyzeDistribution(data, type, windowSize = 50) {
  const window = data.slice(0, windowSize);
  const taiCount = window.filter(d => d.Ket_qua === 'Tài').length;
  const xiuCount = window.length - taiCount;
  
  return {
    taiPercent: (taiCount / window.length) * 100,
    xiuPercent: (xiuCount / window.length) * 100,
    taiCount,
    xiuCount,
    total: window.length,
    imbalance: Math.abs(taiCount - xiuCount) / window.length
  };
}

// ==================== HÀM TÍNH TOÁN DỰ ĐOÁN SIÊU MẠNH ====================

function calculateSuperPrediction(data, type) {
  const last50 = data.slice(0, 50);
  const results = last50.map(d => d.Ket_qua);
  
  initializePatternStats(type);
  
  let predictions = [];
  let factors = [];
  let allPatterns = [];
  
  // THUẬT TOÁN 1: Tổng phân tích
  const tongPhanTich = analyzeTongPhanTich(last50, type);
  if (tongPhanTich.detected) {
    predictions.push({ prediction: tongPhanTich.prediction, confidence: tongPhanTich.confidence, priority: 18, name: tongPhanTich.name });
    factors.push(tongPhanTich.name);
    allPatterns.push(tongPhanTich);
  }
  
  // THUẬT TOÁN 2: Xu hướng mạnh
  const xuHuongManh = analyzeXuHuongManh(results, type);
  if (xuHuongManh.detected) {
    predictions.push({ prediction: xuHuongManh.prediction, confidence: xuHuongManh.confidence, priority: 17, name: xuHuongManh.name });
    factors.push(xuHuongManh.name);
    allPatterns.push(xuHuongManh);
  }
  
  // THUẬT TOÁN 3: Cầu Rồng
  const cauRong = analyzeCauRong(results, type);
  if (cauRong.detected) {
    predictions.push({ prediction: cauRong.prediction, confidence: cauRong.confidence, priority: 17, name: cauRong.name });
    factors.push(cauRong.name);
    allPatterns.push(cauRong);
  }
  
  // THUẬT TOÁN 4: Triple pattern
  const triplePattern = analyzeTriplePattern(results, type);
  if (triplePattern.detected) {
    predictions.push({ prediction: triplePattern.prediction, confidence: triplePattern.confidence, priority: 16, name: triplePattern.name });
    factors.push(triplePattern.name);
    allPatterns.push(triplePattern);
  }
  
  // THUẬT TOÁN 5: Bẻ chuỗi
  const breakStreak = analyzeBreakStreak(results, type);
  if (breakStreak.detected) {
    predictions.push({ prediction: breakStreak.prediction, confidence: breakStreak.confidence, priority: 16, name: breakStreak.name });
    factors.push(breakStreak.name);
    allPatterns.push(breakStreak);
  }
  
  // THUẬT TOÁN 6: Double pair break
  const doublePairBreak = analyzeDoublePairBreak(results, type);
  if (doublePairBreak.detected) {
    predictions.push({ prediction: doublePairBreak.prediction, confidence: doublePairBreak.confidence, priority: 16, name: doublePairBreak.name });
    factors.push(doublePairBreak.name);
    allPatterns.push(doublePairBreak);
  }
  
  // THUẬT TOÁN 7: Cầu thông minh
  const smartBet = analyzeSmartBet(results, type);
  if (smartBet.detected) {
    predictions.push({ prediction: smartBet.prediction, confidence: smartBet.confidence, priority: 15, name: smartBet.name });
    factors.push(smartBet.name);
    allPatterns.push(smartBet);
  }
  
  // THUẬT TOÁN 8: Đảo chiều
  const daoChieu = analyzeDaoChieu(results, type);
  if (daoChieu.detected) {
    predictions.push({ prediction: daoChieu.prediction, confidence: daoChieu.confidence, priority: 15, name: daoChieu.name });
    factors.push(daoChieu.name);
    allPatterns.push(daoChieu);
  }
  
  // THUẬT TOÁN 9: Cầu bệt kéo
  const cauBetKeo = analyzeCauBetKeo(results, type);
  if (cauBetKeo.detected) {
    predictions.push({ prediction: cauBetKeo.prediction, confidence: cauBetKeo.confidence, priority: 15, name: cauBetKeo.name });
    factors.push(cauBetKeo.name);
    allPatterns.push(cauBetKeo);
  }
  
  // THUẬT TOÁN 10: Cầu lặp lại
  const cauLapLai = analyzeCauLapLai(results, type);
  if (cauLapLai.detected) {
    predictions.push({ prediction: cauLapLai.prediction, confidence: cauLapLai.confidence, priority: 14, name: cauLapLai.name });
    factors.push(cauLapLai.name);
    allPatterns.push(cauLapLai);
  }
  
  // THUẬT TOÁN 11: Cầu bệt
  const cauBet = analyzeCauBet(results, type);
  if (cauBet.detected) {
    predictions.push({ prediction: cauBet.prediction, confidence: cauBet.confidence, priority: 14, name: cauBet.name });
    factors.push(cauBet.name);
    allPatterns.push(cauBet);
  }
  
  // THUẬT TOÁN 12: Cầu đảo 1-1
  const cauDao11 = analyzeCauDao11(results, type);
  if (cauDao11.detected) {
    predictions.push({ prediction: cauDao11.prediction, confidence: cauDao11.confidence, priority: 14, name: cauDao11.name });
    factors.push(cauDao11.name);
    allPatterns.push(cauDao11);
  }
  
  // THUẬT TOÁN 13: Cầu 2-2
  const cau22 = analyzeCau22(results, type);
  if (cau22.detected) {
    predictions.push({ prediction: cau22.prediction, confidence: cau22.confidence, priority: 13, name: cau22.name });
    factors.push(cau22.name);
    allPatterns.push(cau22);
  }
  
  // THUẬT TOÁN 14: Cầu 3-3
  const cau33 = analyzeCau33(results, type);
  if (cau33.detected) {
    predictions.push({ prediction: cau33.prediction, confidence: cau33.confidence, priority: 13, name: cau33.name });
    factors.push(cau33.name);
    allPatterns.push(cau33);
  }
  
  // THUẬT TOÁN 15: Đảo chiều mạnh
  const cauDaoChieuManh = analyzeCauDaoChieuManh(results, type);
  if (cauDaoChieuManh.detected) {
    predictions.push({ prediction: cauDaoChieuManh.prediction, confidence: cauDaoChieuManh.confidence, priority: 13, name: cauDaoChieuManh.name });
    factors.push(cauDaoChieuManh.name);
    allPatterns.push(cauDaoChieuManh);
  }
  
  // THUẬT TOÁN 16: Cầu xen kẽ mạnh
  const cauXenKeManh = analyzeCauXenKeManh(results, type);
  if (cauXenKeManh.detected) {
    predictions.push({ prediction: cauXenKeManh.prediction, confidence: cauXenKeManh.confidence, priority: 13, name: cauXenKeManh.name });
    factors.push(cauXenKeManh.name);
    allPatterns.push(cauXenKeManh);
  }
  
  // THUẬT TOÁN 17: Cầu 1-2-1
  const cau121 = analyzeCau121(results, type);
  if (cau121.detected) {
    predictions.push({ prediction: cau121.prediction, confidence: cau121.confidence, priority: 12, name: cau121.name });
    factors.push(cau121.name);
    allPatterns.push(cau121);
  }
  
  // THUẬT TOÁN 18: Cầu 1-2-3
  const cau123 = analyzeCau123(results, type);
  if (cau123.detected) {
    predictions.push({ prediction: cau123.prediction, confidence: cau123.confidence, priority: 12, name: cau123.name });
    factors.push(cau123.name);
    allPatterns.push(cau123);
  }
  
  // THUẬT TOÁN 19: Cầu 3-2-1
  const cau321 = analyzeCau321(results, type);
  if (cau321.detected) {
    predictions.push({ prediction: cau321.prediction, confidence: cau321.confidence, priority: 12, name: cau321.name });
    factors.push(cau321.name);
    allPatterns.push(cau321);
  }
  
  // THUẬT TOÁN 20: Cầu cao thấp
  const caoThap = analyzeCaoThap(last50, type);
  if (caoThap.detected) {
    predictions.push({ prediction: caoThap.prediction, confidence: caoThap.confidence, priority: 12, name: caoThap.name });
    factors.push(caoThap.name);
    allPatterns.push(caoThap);
  }
  
  // THUẬT TOÁN 21: Cầu kéo
  const cauKeo = analyzeCauKeo(results, type);
  if (cauKeo.detected) {
    predictions.push({ prediction: cauKeo.prediction, confidence: cauKeo.confidence, priority: 12, name: cauKeo.name });
    factors.push(cauKeo.name);
    allPatterns.push(cauKeo);
  }
  
  // THUẬT TOÁN 22: Cầu đẩy
  const cauDay = analyzeCauDay(results, type);
  if (cauDay.detected) {
    predictions.push({ prediction: cauDay.prediction, confidence: cauDay.confidence, priority: 12, name: cauDay.name });
    factors.push(cauDay.name);
    allPatterns.push(cauDay);
  }
  
  // THUẬT TOÁN 23: Cầu lỡi
  const cauLoi = analyzeCauLoi(results, type);
  if (cauLoi.detected) {
    predictions.push({ prediction: cauLoi.prediction, confidence: cauLoi.confidence, priority: 12, name: cauLoi.name });
    factors.push(cauLoi.name);
    allPatterns.push(cauLoi);
  }
  
  // THUẬT TOÁN 24: Cầu gãy khúc
  const cauGayKhuc = analyzeCauGayKhuc(results, type);
  if (cauGayKhuc.detected) {
    predictions.push({ prediction: cauGayKhuc.prediction, confidence: cauGayKhuc.confidence, priority: 12, name: cauGayKhuc.name });
    factors.push(cauGayKhuc.name);
    allPatterns.push(cauGayKhuc);
  }
  
  // THUẬT TOÁN 25: Cầu 3 đẩy
  const cau3Day = analyzeCau3Day(results, type);
  if (cau3Day.detected) {
    predictions.push({ prediction: cau3Day.prediction, confidence: cau3Day.confidence, priority: 11, name: cau3Day.name });
    factors.push(cau3Day.name);
    allPatterns.push(cau3Day);
  }
  
  // THUẬT TOÁN 26: Cầu 4 đẩy
  const cau4Day = analyzeCau4Day(results, type);
  if (cau4Day.detected) {
    predictions.push({ prediction: cau4Day.prediction, confidence: cau4Day.confidence, priority: 11, name: cau4Day.name });
    factors.push(cau4Day.name);
    allPatterns.push(cau4Day);
  }
  
  // THUẬT TOÁN 27: Cầu 5 đẩy
  const cau5Day = analyzeCau5Day(results, type);
  if (cau5Day.detected) {
    predictions.push({ prediction: cau5Day.prediction, confidence: cau5Day.confidence, priority: 11, name: cau5Day.name });
    factors.push(cau5Day.name);
    allPatterns.push(cau5Day);
  }
  
  // THUẬT TOÁN 28: Cầu đối xứng
  const cauDoiXung = analyzeCauDoiXung(results, type);
  if (cauDoiXung.detected) {
    predictions.push({ prediction: cauDoiXung.prediction, confidence: cauDoiXung.confidence, priority: 11, name: cauDoiXung.name });
    factors.push(cauDoiXung.name);
    allPatterns.push(cauDoiXung);
  }
  
  // THUẬT TOÁN 29: Cầu phức hợp
  const cauPhucHop = analyzeCauPhucHop(last50, type);
  if (cauPhucHop.detected) {
    predictions.push({ prediction: cauPhucHop.prediction, confidence: cauPhucHop.confidence, priority: 11, name: cauPhucHop.name });
    factors.push(cauPhucHop.name);
    allPatterns.push(cauPhucHop);
  }
  
  // THUẬT TOÁN 30: Cầu dự báo
  const cauDuBao = analyzeCauDuBao(results, type);
  if (cauDuBao.detected) {
    predictions.push({ prediction: cauDuBao.prediction, confidence: cauDuBao.confidence, priority: 11, name: cauDuBao.name });
    factors.push(cauDuBao.name);
    allPatterns.push(cauDuBao);
  }
  
  // THUẬT TOÁN 31: Cầu bất ngờ
  const cauBatNgo = analyzeCauBatNgo(results, type);
  if (cauBatNgo.detected) {
    predictions.push({ prediction: cauBatNgo.prediction, confidence: cauBatNgo.confidence, priority: 10, name: cauBatNgo.name });
    factors.push(cauBatNgo.name);
    allPatterns.push(cauBatNgo);
  }
  
  // THUẬT TOÁN 32: Cầu thông minh
  const cauThongMinh = analyzeCauThongMinh(last50, type);
  if (cauThongMinh.detected) {
    predictions.push({ prediction: cauThongMinh.prediction, confidence: cauThongMinh.confidence, priority: 10, name: cauThongMinh.name });
    factors.push(cauThongMinh.name);
    allPatterns.push(cauThongMinh);
  }
  
  // THUẬT TOÁN 33: Cầu nhảy cóc
  const cauNhayCoc = analyzeCauNhayCoc(results, type);
  if (cauNhayCoc.detected) {
    predictions.push({ prediction: cauNhayCoc.prediction, confidence: cauNhayCoc.confidence, priority: 10, name: cauNhayCoc.name });
    factors.push(cauNhayCoc.name);
    allPatterns.push(cauNhayCoc);
  }
  
  // THUẬT TOÁN 34: Alternating break
  const alternatingBreak = analyzeAlternatingBreak(results, type);
  if (alternatingBreak.detected) {
    predictions.push({ prediction: alternatingBreak.prediction, confidence: alternatingBreak.confidence, priority: 10, name: alternatingBreak.name });
    factors.push(alternatingBreak.name);
    allPatterns.push(alternatingBreak);
  }
  
  // THUẬT TOÁN 35: Cầu bẻ cầu
  const cauBeCau = analyzeCauBeCau(results, type);
  if (cauBeCau.detected) {
    predictions.push({ prediction: cauBeCau.prediction, confidence: cauBeCau.confidence, priority: 10, name: cauBeCau.name });
    factors.push(cauBeCau.name);
    allPatterns.push(cauBeCau);
  }
  
  // THUẬT TOÁN 36: Phân bố lệch
  const distribution = analyzeDistribution(last50, type);
  if (distribution.imbalance > 0.15) {
    const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
    predictions.push({ prediction: minority, confidence: 68, priority: 8, name: 'Phân bố lệch' });
    factors.push(`Phân bố lệch (T:${distribution.taiPercent.toFixed(0)}% - X:${distribution.xiuPercent.toFixed(0)}%)`);
  }
  
  // Nếu không có pattern nào, dùng cầu tự nhiên
  if (predictions.length === 0) {
    predictions.push({ prediction: results[0], confidence: 55, priority: 1, name: 'Cầu Tự Nhiên (Theo ván trước)' });
    factors.push('Cầu Tự Nhiên');
  }
  
  // Sắp xếp theo priority và confidence
  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  // Tính điểm cho Tài và Xỉu
  const taiVotes = predictions.filter(p => p.prediction === 'Tài');
  const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
  
  let taiScore = taiVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  let xiuScore = xiuVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  
  // Điều chỉnh theo lịch sử thắng/thua
  const streakInfo = learningData[type].streakAnalysis;
  if (streakInfo.currentStreak <= -3) {
    if (taiScore > xiuScore) {
      xiuScore *= 1.4;
    } else {
      taiScore *= 1.4;
    }
  }
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  // Điều chỉnh thông minh
  finalPrediction = getSmartPredictionAdjustment(type, finalPrediction, allPatterns);
  
  // Tính confidence
  let baseConfidence = 68;
  
  const topPredictions = predictions.slice(0, 5);
  topPredictions.forEach(p => {
    if (p.prediction === finalPrediction) {
      baseConfidence += (p.confidence - 68) * 0.35;
    }
  });
  
  const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / predictions.length;
  baseConfidence += Math.round(agreementRatio * 12);
  
  const adaptiveBoost = getAdaptiveConfidenceBoost(type);
  baseConfidence += adaptiveBoost;
  
  let finalConfidence = Math.round(baseConfidence);
  
  // Giới hạn confidence 62-94%
  finalConfidence = Math.max(62, Math.min(94, finalConfidence));
  
  return {
    prediction: finalPrediction,
    confidence: finalConfidence,
    factors,
    allPatterns,
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiVotes: taiVotes.length,
      xiuVotes: xiuVotes.length,
      taiScore,
      xiuScore,
      topPattern: predictions[0]?.name || 'N/A',
      distribution,
      learningStats: {
        totalPredictions: learningData[type].totalPredictions,
        correctPredictions: learningData[type].correctPredictions,
        accuracy: learningData[type].totalPredictions > 0
          ? (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%'
          : 'N/A',
        currentStreak: learningData[type].streakAnalysis.currentStreak
      }
    }
  };
}

function savePredictionToHistory(type, phien, prediction, confidence, latestData) {
  const record = {
    Phien: latestData.Phien,
    Xuc_xac_1: latestData.Xuc_xac_1,
    Xuc_xac_2: latestData.Xuc_xac_2,
    Xuc_xac_3: latestData.Xuc_xac_3,
    Tong: latestData.Tong,
    Ket_qua: latestData.Ket_qua,
    Do_tin_cay: `${confidence}%`,
    Phien_hien_tai: phien.toString(),
    Du_doan: prediction,
    ket_qua_du_doan: '',
    id: '@tranhoang2286',
    timestamp: new Date().toISOString()
  };
  
  predictionHistory[type].unshift(record);
  
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  
  return record;
}

// ==================== ENDPOINTS ====================

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('API Tài Xỉu - @tranhoang2286');
});

app.get('/lc79-hu', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('hu', data);
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const result = calculateSuperPrediction(data, 'hu');
    
    const record = savePredictionToHistory('hu', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('hu', nextPhien, result.prediction, result.confidence, result.factors);
    
    setTimeout(async () => {
      await updateHistoryStatus('hu');
    }, 5000);
    
    res.json({
      Phien: record.Phien,
      Xuc_xac_1: record.Xuc_xac_1,
      Xuc_xac_2: record.Xuc_xac_2,
      Xuc_xac_3: record.Xuc_xac_3,
      Tong: record.Tong,
      Ket_qua: record.Ket_qua,
      Do_tin_cay: record.Do_tin_cay,
      Phien_hien_tai: record.Phien_hien_tai,
      Du_doan: record.Du_doan,
      ket_qua_du_doan: record.ket_qua_du_doan || '',
      id: record.id
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-md5', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('md5', data);
    
    const latestPhien = data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const result = calculateSuperPrediction(data, 'md5');
    
    const record = savePredictionToHistory('md5', nextPhien, result.prediction, result.confidence, data[0]);
    recordPrediction('md5', nextPhien, result.prediction, result.confidence, result.factors);
    
    setTimeout(async () => {
      await updateHistoryStatus('md5');
    }, 5000);
    
    res.json({
      Phien: record.Phien,
      Xuc_xac_1: record.Xuc_xac_1,
      Xuc_xac_2: record.Xuc_xac_2,
      Xuc_xac_3: record.Xuc_xac_3,
      Tong: record.Tong,
      Ket_qua: record.Ket_qua,
      Do_tin_cay: record.Do_tin_cay,
      Phien_hien_tai: record.Phien_hien_tai,
      Du_doan: record.Du_doan,
      ket_qua_du_doan: record.ket_qua_du_doan || '',
      id: record.id
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-hu/lichsu', async (req, res) => {
  try {
    await updateHistoryStatus('hu');
    
    res.json({
      type: 'Tài Xỉu Hũ - @tranhoang2286',
      history: predictionHistory.hu,
      total: predictionHistory.hu.length
    });
  } catch (error) {
    res.json({
      type: 'Tài Xỉu Hũ - @tranhoang2286',
      history: predictionHistory.hu,
      total: predictionHistory.hu.length
    });
  }
});

app.get('/lc79-md5/lichsu', async (req, res) => {
  try {
    await updateHistoryStatus('md5');
    
    res.json({
      type: 'Tài Xỉu MD5 - @tranhoang2286',
      history: predictionHistory.md5,
      total: predictionHistory.md5.length
    });
  } catch (error) {
    res.json({
      type: 'Tài Xỉu MD5 - @tranhoang2286',
      history: predictionHistory.md5,
      total: predictionHistory.md5.length
    });
  }
});

app.get('/lc79-hu/analysis', async (req, res) => {
  try {
    const data = await fetchDataHu();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('hu', data);
    
    const result = calculateSuperPrediction(data, 'hu');
    res.json({
      prediction: result.prediction,
      confidence: result.confidence,
      factors: result.factors,
      analysis: result.detailedAnalysis
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-md5/analysis', async (req, res) => {
  try {
    const data = await fetchDataMd5();
    if (!data || data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('md5', data);
    
    const result = calculateSuperPrediction(data, 'md5');
    res.json({
      prediction: result.prediction,
      confidence: result.confidence,
      factors: result.factors,
      analysis: result.detailedAnalysis
    });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/lc79-hu/learning', (req, res) => {
  const stats = learningData.hu;
  const accuracy = stats.totalPredictions > 0 
    ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2)
    : 0;
  
  res.json({
    type: 'Tài Xỉu Hũ - Learning Stats',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    streakAnalysis: stats.streakAnalysis
  });
});

app.get('/lc79-md5/learning', (req, res) => {
  const stats = learningData.md5;
  const accuracy = stats.totalPredictions > 0 
    ? (stats.correctPredictions / stats.totalPredictions * 100).toFixed(2)
    : 0;
  
  res.json({
    type: 'Tài Xỉu MD5 - Learning Stats',
    totalPredictions: stats.totalPredictions,
    correctPredictions: stats.correctPredictions,
    overallAccuracy: `${accuracy}%`,
    streakAnalysis: stats.streakAnalysis
  });
});

app.get('/reset-learning', (req, res) => {
  learningData = {
    hu: {
      predictions: [],
      patternStats: {},
      totalPredictions: 0,
      correctPredictions: 0,
      patternWeights: { ...DEFAULT_PATTERN_WEIGHTS },
      lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      adaptiveThresholds: {},
      recentAccuracy: []
    },
    md5: {
      predictions: [],
      patternStats: {},
      totalPredictions: 0,
      correctPredictions: 0,
      patternWeights: { ...DEFAULT_PATTERN_WEIGHTS },
      lastUpdate: null,
      streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
      adaptiveThresholds: {},
      recentAccuracy: []
    }
  };
  saveLearningData();
  res.json({ message: 'Learning data reset successfully' });
});

loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log('Tài Xỉu Prediction API v7.0 - ULTIMATE');
  console.log('');
  console.log('🚀 THUẬT TOÁN SIÊU MẠNH VỚI 36+ PATTERN:');
  console.log('  - Cầu Bệt, Đảo 1-1, 2-2, 3-3');
  console.log('  - Cầu 1-2-1, 1-2-3, 3-2-1');
  console.log('  - Cầu Rồng, Cao Thấp, Kéo, Đẩy');
  console.log('  - Cầu Đối Xứng, Phức Hợp, Dự Báo');
  console.log('  - Cầu Thông Minh, Bất Ngờ, Gãy Khúc');
  console.log('  - Tổng Phân Tích, Xu Hướng Mạnh, Đảo Chiều');
  console.log('  - 3 Đẩy, 4 Đẩy, 5 Đẩy');
  console.log('  - Xen Kẽ Mạnh, Bệt Kéo, Đảo Chiều Mạnh');
  console.log('  - Và nhiều pattern khác...');
  console.log('');
  console.log('📁 FILE: tranhoang.json, tranhoang1.json');
  console.log('👤 ID: @tranhoang2286');
  console.log('🔗 LINK: https://scaling-octo-pancake-nox2.onrender.com');
  
  startAutoSaveTask();
});
