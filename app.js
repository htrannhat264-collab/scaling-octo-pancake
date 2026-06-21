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

// ==================== DỮ LIỆU MẪU DỰ PHÒNG ====================
const SAMPLE_DATA = [
  { Phien: 3142568, Ket_qua: 'Tài', Xuc_xac_1: 5, Xuc_xac_2: 3, Xuc_xac_3: 4, Tong: 12 },
  { Phien: 3142569, Ket_qua: 'Xỉu', Xuc_xac_1: 2, Xuc_xac_2: 3, Xuc_xac_3: 3, Tong: 8 },
  { Phien: 3142570, Ket_qua: 'Tài', Xuc_xac_1: 6, Xuc_xac_2: 5, Xuc_xac_3: 4, Tong: 15 },
  { Phien: 3142571, Ket_qua: 'Tài', Xuc_xac_1: 4, Xuc_xac_2: 4, Xuc_xac_3: 3, Tong: 11 },
  { Phien: 3142572, Ket_qua: 'Xỉu', Xuc_xac_1: 2, Xuc_xac_2: 2, Xuc_xac_3: 3, Tong: 7 },
  { Phien: 3142573, Ket_qua: 'Xỉu', Xuc_xac_1: 1, Xuc_xac_2: 2, Xuc_xac_3: 3, Tong: 6 },
  { Phien: 3142574, Ket_qua: 'Tài', Xuc_xac_1: 5, Xuc_xac_2: 5, Xuc_xac_3: 4, Tong: 14 },
  { Phien: 3142575, Ket_qua: 'Tài', Xuc_xac_1: 4, Xuc_xac_2: 5, Xuc_xac_3: 4, Tong: 13 },
  { Phien: 3142576, Ket_qua: 'Xỉu', Xuc_xac_1: 3, Xuc_xac_2: 3, Xuc_xac_3: 3, Tong: 9 },
  { Phien: 3142577, Ket_qua: 'Tài', Xuc_xac_1: 6, Xuc_xac_2: 5, Xuc_xac_3: 5, Tong: 16 }
];

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
    const response = await axios.get(API_URL_HU, { timeout: 5000 });
    if (response.status === 200 && response.data) {
      return transformApiData(response.data);
    }
  } catch (error) {
    console.error('Error fetching HU data:', error.message);
  }
  return null;
}

async function fetchDataMd5() {
  try {
    const response = await axios.get(API_URL_MD5, { timeout: 5000 });
    if (response.status === 200 && response.data) {
      return transformApiData(response.data);
    }
  } catch (error) {
    console.error('Error fetching MD5 data:', error.message);
  }
  return null;
}

// ==================== THUẬT TOÁN PHÂN TÍCH ====================

function analyzeCauBet(results, type) {
  if (results.length < 3) return { detected: false };
  
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
    
    const weight = getPatternWeight(type, 'cau_bet');
    
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

function analyzeCauDao11(results, type) {
  if (results.length < 4) return { detected: false };
  
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
    const weight = getPatternWeight(type, 'cau_dao_11');
    
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

function analyzeCau22(results, type) {
  if (results.length < 6) return { detected: false };
  
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
      const weight = getPatternWeight(type, 'cau_22');
      
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

function analyzeCau33(results, type) {
  if (results.length < 6) return { detected: false };
  
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
    const weight = getPatternWeight(type, 'cau_33');
    
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

function analyzeCau121(results, type) {
  if (results.length < 4) return { detected: false };
  
  const pattern1 = results.slice(0, 4);
  
  if (pattern1[0] !== pattern1[1] &&
    pattern1[1] === pattern1[2] &&
    pattern1[2] !== pattern1[3] &&
    pattern1[0] === pattern1[3]) {
    const weight = getPatternWeight(type, 'cau_121');
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

function analyzeCau123(results, type) {
  if (results.length < 6) return { detected: false };
  
  const first = results[5];
  const nextTwo = results.slice(3, 5);
  const lastThree = results.slice(0, 3);
  
  if (nextTwo[0] === nextTwo[1] && nextTwo[0] !== first) {
    const allSame = lastThree.every(r => r === lastThree[0]);
    if (allSame && lastThree[0] !== nextTwo[0]) {
      const weight = getPatternWeight(type, 'cau_123');
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

function analyzeCau321(results, type) {
  if (results.length < 6) return { detected: false };
  
  const first3 = results.slice(3, 6);
  const next2 = results.slice(1, 3);
  const last1 = results[0];
  
  const first3Same = first3.every(r => r === first3[0]);
  const next2Same = next2.every(r => r === next2[0]);
  
  if (first3Same && next2Same && first3[0] !== next2[0] && last1 !== next2[0]) {
    const weight = getPatternWeight(type, 'cau_321');
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

function analyzeCauNhayCoc(results, type) {
  if (results.length < 6) return { detected: false };
  
  const skipPattern = [];
  for (let i = 0; i < Math.min(results.length, 12); i += 2) {
    skipPattern.push(results[i]);
  }
  
  if (skipPattern.length >= 3) {
    const weight = getPatternWeight(type, 'cau_nhay_coc');
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

function analyzeXuHuongManh(results, type) {
  if (results.length < 8) return { detected: false };
  
  const taiCount = results.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'xu_huong_manh');
  
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

function analyzeDaoChieu(results, type) {
  if (results.length < 5) return { detected: false };
  
  let isAlternating = true;
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i] === results[i + 1]) {
      isAlternating = false;
      break;
    }
  }
  
  if (isAlternating) {
    const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
    const weight = getPatternWeight(type, 'dao_chieu');
    return {
      detected: true,
      prediction,
      confidence: Math.round(78 * weight),
      name: `Đảo Chiều (Chuỗi ${results.join('-')} → ${prediction})`,
      patternId: 'dao_chieu'
    };
  }
  
  return { detected: false };
}

function analyzeCauRong(results, type) {
  if (results.length < 6) return { detected: false };
  
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
    const weight = getPatternWeight(type, 'cau_rong');
    return {
      detected: true,
      prediction: streakType === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round((85 + streakLength * 2) * weight),
      name: `Cầu Rồng ${streakLength} phiên (Bẻ mạnh)`,
      patternId: 'cau_rong'
    };
  }
  
  return { detected: false };
}

// ==================== HÀM DỰ ĐOÁN CHÍNH ====================

function calculateSuperPrediction(data, type) {
  // Nếu không có dữ liệu, dùng dữ liệu mẫu
  if (!data || data.length === 0) {
    console.log(`[⚠️] Không có dữ liệu cho ${type}, dùng dữ liệu mẫu`);
    data = SAMPLE_DATA;
  }
  
  const results = data.map(d => d.Ket_qua);
  
  initializePatternStats(type);
  
  let predictions = [];
  let factors = [];
  let allPatterns = [];
  
  // Chạy các thuật toán
  const cauBet = analyzeCauBet(results, type);
  if (cauBet.detected) {
    predictions.push({ prediction: cauBet.prediction, confidence: cauBet.confidence, priority: 15, name: cauBet.name });
    factors.push(cauBet.name);
    allPatterns.push(cauBet);
  }
  
  const cauDao11 = analyzeCauDao11(results, type);
  if (cauDao11.detected) {
    predictions.push({ prediction: cauDao11.prediction, confidence: cauDao11.confidence, priority: 14, name: cauDao11.name });
    factors.push(cauDao11.name);
    allPatterns.push(cauDao11);
  }
  
  const cau22 = analyzeCau22(results, type);
  if (cau22.detected) {
    predictions.push({ prediction: cau22.prediction, confidence: cau22.confidence, priority: 13, name: cau22.name });
    factors.push(cau22.name);
    allPatterns.push(cau22);
  }
  
  const cau33 = analyzeCau33(results, type);
  if (cau33.detected) {
    predictions.push({ prediction: cau33.prediction, confidence: cau33.confidence, priority: 13, name: cau33.name });
    factors.push(cau33.name);
    allPatterns.push(cau33);
  }
  
  const cau121 = analyzeCau121(results, type);
  if (cau121.detected) {
    predictions.push({ prediction: cau121.prediction, confidence: cau121.confidence, priority: 12, name: cau121.name });
    factors.push(cau121.name);
    allPatterns.push(cau121);
  }
  
  const cau123 = analyzeCau123(results, type);
  if (cau123.detected) {
    predictions.push({ prediction: cau123.prediction, confidence: cau123.confidence, priority: 12, name: cau123.name });
    factors.push(cau123.name);
    allPatterns.push(cau123);
  }
  
  const cau321 = analyzeCau321(results, type);
  if (cau321.detected) {
    predictions.push({ prediction: cau321.prediction, confidence: cau321.confidence, priority: 12, name: cau321.name });
    factors.push(cau321.name);
    allPatterns.push(cau321);
  }
  
  const cauNhayCoc = analyzeCauNhayCoc(results, type);
  if (cauNhayCoc.detected) {
    predictions.push({ prediction: cauNhayCoc.prediction, confidence: cauNhayCoc.confidence, priority: 11, name: cauNhayCoc.name });
    factors.push(cauNhayCoc.name);
    allPatterns.push(cauNhayCoc);
  }
  
  const tongPhanTich = analyzeTongPhanTich(data, type);
  if (tongPhanTich.detected) {
    predictions.push({ prediction: tongPhanTich.prediction, confidence: tongPhanTich.confidence, priority: 16, name: tongPhanTich.name });
    factors.push(tongPhanTich.name);
    allPatterns.push(tongPhanTich);
  }
  
  const xuHuongManh = analyzeXuHuongManh(results, type);
  if (xuHuongManh.detected) {
    predictions.push({ prediction: xuHuongManh.prediction, confidence: xuHuongManh.confidence, priority: 15, name: xuHuongManh.name });
    factors.push(xuHuongManh.name);
    allPatterns.push(xuHuongManh);
  }
  
  const daoChieu = analyzeDaoChieu(results, type);
  if (daoChieu.detected) {
    predictions.push({ prediction: daoChieu.prediction, confidence: daoChieu.confidence, priority: 14, name: daoChieu.name });
    factors.push(daoChieu.name);
    allPatterns.push(daoChieu);
  }
  
  const cauRong = analyzeCauRong(results, type);
  if (cauRong.detected) {
    predictions.push({ prediction: cauRong.prediction, confidence: cauRong.confidence, priority: 16, name: cauRong.name });
    factors.push(cauRong.name);
    allPatterns.push(cauRong);
  }
  
  // Nếu không có pattern nào, dùng cầu tự nhiên
  if (predictions.length === 0) {
    const lastResult = results.length > 0 ? results[0] : 'Tài';
    predictions.push({ prediction: lastResult, confidence: 55, priority: 1, name: 'Cầu Tự Nhiên (Theo ván trước)' });
    factors.push('Cầu Tự Nhiên');
  }
  
  // Sắp xếp theo priority và confidence
  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  // Tính điểm
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
    let data = await fetchDataHu();
    
    // Nếu không có dữ liệu, dùng dữ liệu mẫu
    if (!data || data.length === 0) {
      console.log('[⚠️] Không có dữ liệu HU, dùng dữ liệu mẫu');
      data = SAMPLE_DATA;
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
      id: record.id,
      note: data === SAMPLE_DATA ? '⚠️ Dữ liệu mẫu (API đang lỗi)' : undefined
    });
  } catch (error) {
    console.error('Error:', error);
    // Trả về dự đoán mặc định khi lỗi
    res.json({
      Phien: 0,
      Xuc_xac_1: 3,
      Xuc_xac_2: 3,
      Xuc_xac_3: 3,
      Tong: 9,
      Ket_qua: 'Chưa có',
      Do_tin_cay: '55%',
      Phien_hien_tai: '1',
      Du_doan: 'Tài',
      ket_qua_du_doan: '',
      id: '@tranhoang2286',
      note: '⚠️ API đang lỗi, dự đoán mặc định Tài'
    });
  }
});

app.get('/lc79-md5', async (req, res) => {
  try {
    let data = await fetchDataMd5();
    
    // Nếu không có dữ liệu, dùng dữ liệu mẫu
    if (!data || data.length === 0) {
      console.log('[⚠️] Không có dữ liệu MD5, dùng dữ liệu mẫu');
      data = SAMPLE_DATA;
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
      id: record.id,
      note: data === SAMPLE_DATA ? '⚠️ Dữ liệu mẫu (API đang lỗi)' : undefined
    });
  } catch (error) {
    console.error('Error:', error);
    // Trả về dự đoán mặc định khi lỗi
    res.json({
      Phien: 0,
      Xuc_xac_1: 3,
      Xuc_xac_2: 3,
      Xuc_xac_3: 3,
      Tong: 9,
      Ket_qua: 'Chưa có',
      Do_tin_cay: '55%',
      Phien_hien_tai: '1',
      Du_doan: 'Xỉu',
      ket_qua_du_doan: '',
      id: '@tranhoang2286',
      note: '⚠️ API đang lỗi, dự đoán mặc định Xỉu'
    });
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
    let data = await fetchDataHu();
    if (!data || data.length === 0) {
      data = SAMPLE_DATA;
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
    let data = await fetchDataMd5();
    if (!data || data.length === 0) {
      data = SAMPLE_DATA;
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
  console.log('Tài Xỉu Prediction API v7.1 - FIX LỖI');
  console.log('');
  console.log('🔧 FIX:');
  console.log('  - Thêm dữ liệu mẫu dự phòng khi API lỗi');
  console.log('  - Bắt lỗi và trả về dự đoán mặc định');
  console.log('  - Giảm timeout xuống 5s để tránh treo');
  console.log('');
  console.log('📁 FILE: tranhoang.json, tranhoang1.json');
  console.log('👤 ID: @tranhoang2286');
  console.log('🔗 LINK: https://scaling-octo-pancake-nox2.onrender.com');
  
  startAutoSaveTask();
});
