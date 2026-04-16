import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import { db } from "./firebase";
import { collection, doc, getDocs, setDoc } from "firebase/firestore";

function App() {
  const [allMonthsMaster, setAllMonthsMaster] = useState({}); 
  const [allMonthsOrder, setAllMonthsOrder] = useState({});
  
  const [selectedMonth, setSelectedMonth] = useState("전체"); 
  const [storeNames, setStoreNames] = useState([]);
  const [selectedStore, setSelectedStore] = useState("");

  const [reportExclusiveRows, setReportExclusiveRows] = useState([]);
  const [unusedRows, setUnusedRows] = useState([]);
  const [summary, setSummary] = useState(null);

  const formatSheetName = (name) => {
    const num = name.replace(/[^0-9]/g, "");
    return num ? `${num}월` : name;
  };

  useEffect(() => {
    const fetchStores = async () => {
      try {
        const snap = await getDocs(collection(db, "reports"));
        const names = snap.docs.map((d) => d.id.split('_').pop()); 
        if (names.length > 0) {
          setStoreNames([...new Set(names)].sort());
        }
      } catch (err) {
        console.error("매장 목록 로드 실패:", err);
      }
    };
    fetchStores();
  }, []);

  const masterComputed = useMemo(() => {
    const currentMaster = selectedMonth === "전체" 
      ? Object.values(allMonthsMaster).flat()
      : (allMonthsMaster[selectedMonth] || []);
      
    const masterMap = {};
    const exclusiveNamesSet = new Set();
    currentMaster.forEach((item) => {
      const name = String(item["올바른 상품명"] || "").trim();
      if (!name) return;
      const type = String(item["전용 유무"] || "").trim();
      const importance = String(item["중요도"] || "").trim();
      masterMap[name] = { 전용유무: type, 중요도: importance };
      if (type === "전용") exclusiveNamesSet.add(name);
    });
    return { masterMap, totalExclusiveInMaster: exclusiveNamesSet.size };
  }, [allMonthsMaster, selectedMonth]);

  const handleMasterUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const workbook = XLSX.read(evt.target.result, { type: "binary" });
      const tempMap = {};
      workbook.SheetNames.forEach(name => {
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[name], { range: 3 });
        tempMap[formatSheetName(name)] = json;
      });
      setAllMonthsMaster(tempMap);
    };
    reader.readAsBinaryString(file);
    e.target.value = ""; 
  };

  const handleOrderUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const workbook = XLSX.read(evt.target.result, { type: "binary" });
      const tempMap = {};
      const allStores = new Set();
      workbook.SheetNames.forEach(name => {
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[name], { range: 3 });
        tempMap[formatSheetName(name)] = json;
        json.forEach(r => {
          const sName = String(r["매장명"] || "").trim();
          if (sName) allStores.add(sName);
        });
      });
      setAllMonthsOrder(tempMap);
      setStoreNames(Array.from(allStores).sort());
      setSelectedStore(""); 
    };
    reader.readAsBinaryString(file);
    e.target.value = ""; 
  };

  useEffect(() => {
    if (!selectedStore) return;

    let rawFiltered = [];
    if (selectedMonth === "전체") {
      rawFiltered = Object.values(allMonthsOrder).flat().filter(r => String(r["매장명"]).trim() === selectedStore);
    } else {
      const currentOrders = allMonthsOrder[selectedMonth] || [];
      rawFiltered = currentOrders.filter(r => String(r["매장명"]).trim() === selectedStore);
    }

    const { masterMap, totalExclusiveInMaster } = masterComputed;
    const aggMap = {};
    rawFiltered.forEach(r => {
      const name = String(r["상품명"]).trim();
      if (masterMap[name]?.전용유무 === "전용") {
        if (!aggMap[name]) {
          aggMap[name] = { ...r, 수량: 0, 중요도: masterMap[name]?.중요도 || "" };
        }
        aggMap[name].수량 += (Number(r.수량) || 0);
      }
    });

    const exclusiveOnly = Object.values(aggMap);
    exclusiveOnly.sort((a, b) => b.수량 - a.수량);
    const usedExclusiveNames = new Set(exclusiveOnly.map(r => String(r["상품명"]).trim()));
    
    const unusedSource = selectedMonth === "전체" 
      ? Object.values(allMonthsMaster).flat() 
      : (allMonthsMaster[selectedMonth] || []);

    const unusedMap = {};
    unusedSource.forEach(m => {
      const name = String(m["올바른 상품명"]).trim();
      if (String(m["전용 유무"]).trim() === "전용" && !usedExclusiveNames.has(name)) {
        unusedMap[name] = { 상품명: name, 전용유무: "전용", 중요도: String(m["중요도"]).trim() };
      }
    });
    const unused = Object.values(unusedMap);

    setReportExclusiveRows(exclusiveOnly);
    setUnusedRows(unused);
    setSummary({
      totalExclusiveInMaster: totalExclusiveInMaster,
      usedExclusiveCount: usedExclusiveNames.size,
      unusedExclusiveCount: unused.length,
      exclusiveUsageRate: totalExclusiveInMaster > 0 ? Math.round((usedExclusiveNames.size / totalExclusiveInMaster) * 1000) / 10 : 0
    });
  }, [selectedMonth, selectedStore, allMonthsOrder, masterComputed, allMonthsMaster]);

  // [기능 개선: 데이터 용량 초과 방지를 위한 청크 저장 로직]
  const saveAllStoresToServer = async () => {
    if (Object.keys(allMonthsOrder).length === 0) return alert("파일을 업로드해주세요.");
    
    try {
      for (const month in allMonthsOrder) {
        const masterData = allMonthsMaster[month] || [];
        const orderData = allMonthsOrder[month] || [];

        // 데이터가 너무 크면 쪼개서 저장 (청크 단위: 500행)
        const chunkSize = 500;
        for (let i = 0; i < orderData.length; i += chunkSize) {
          const chunk = orderData.slice(i, i + chunkSize);
          const partIndex = Math.floor(i / chunkSize) + 1;
          
          // 문서 ID를 '1월_all_data_part1', '1월_all_data_part2' 식으로 분산하여 1MB 제한 우회
          await setDoc(doc(db, "reports", `${month}_all_data_part${partIndex}`), {
            month,
            master: i === 0 ? masterData : [], // 마스터 데이터는 첫 번째 파트에만 저장하여 용량 절약
            orders: chunk,
            part: partIndex,
            savedAt: new Date().toISOString()
          });
        }
      }
      alert("✅ 용량 최적화 저장 완료! 데이터가 분할되어 안전하게 저장되었습니다.");
    } catch (err) { 
      console.error(err);
      alert("저장 오류: " + err.message); 
    }
  };

  const downloadExcelReport = () => {
    if (!selectedStore || !summary) return alert("조회된 데이터가 없습니다.");

    const workbook = XLSX.utils.book_new();

    const sheet1Data = [
      ["매장 요약 지표", "", ""],
      ["조회 매장", selectedStore, ""],
      ["조회 월", selectedMonth, ""],
      ["전용상품 전체", summary.totalExclusiveInMaster, "개"],
      ["사용 중인 품목", summary.usedExclusiveCount, "개"],
      ["미사용 품목", summary.unusedExclusiveCount, "개"],
      ["사용 비율", summary.exclusiveUsageRate, "%"],
      [],
      ["매장 전용상품 사용 상세 내역"],
      ["매장명", "상품명", "수량", "단위", "중요도"]
    ];

    reportExclusiveRows.forEach(row => {
      sheet1Data.push([row.매장명, row.상품명, row.수량, row.단위, row.중요도]);
    });

    const worksheet1 = XLSX.utils.aoa_to_sheet(sheet1Data);
    
    worksheet1["!cols"] = [
      { wch: 20 }, 
      { wch: 50 }, 
      { wch: 10 }, 
      { wch: 10 }, 
      { wch: 10 } 
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet1, "사용내역");

    const sheet2Data = [
      ["미사용 전용상품 목록"],
      ["상품명", "전용유무", "중요도"]
    ];

    unusedRows.forEach(row => {
      sheet2Data.push([row.상품명, row.전용유무, row.중요도]);
    });

    const worksheet2 = XLSX.utils.aoa_to_sheet(sheet2Data);
    
    worksheet2["!cols"] = [
      { wch: 50 }, 
      { wch: 15 }, 
      { wch: 10 } 
    ];
    XLSX.utils.book_append_sheet(workbook, worksheet2, "미사용품목");

    XLSX.writeFile(workbook, `${selectedStore}_${selectedMonth}_전용상품_리포트.xlsx`);
  };

  const cardStyle = { backgroundColor: "#ffffff", borderRadius: "12px", padding: "20px", marginBottom: "20px", boxShadow: "0 4px 10px rgba(0,0,0,0.08)", textAlign: "left", position: "relative" };
  const uploadCardStyle = (isActive) => ({
    ...cardStyle, flex: "1", minWidth: "300px", border: "none", backgroundColor: isActive ? "#f1f8e9" : "#ffffff", transition: "all 0.3s ease"
  });
  const deleteButtonStyle = { backgroundColor: "#d32f2f", color: "white", border: "none", borderRadius: "6px", padding: "6px 14px", cursor: "pointer", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" };
  const headerCellStyle = { position: "sticky", top: 0, backgroundColor: "#f5f5f5", zIndex: 2, padding: "10px", textAlign: "center", borderBottom: "2px solid #ddd", color: "#000", fontWeight: "bold" };
  const cellStyle = { padding: "8px", borderBottom: "1px solid #eee", whiteSpace: "nowrap", textAlign: "center", color: "#000" };
  const getImportanceColor = (importance) => { if (importance === "S") return "#ffcccc"; if (importance === "A") return "#ffe7b3"; if (importance === "B") return "#d6e0ff"; return ""; };

  return (
    <div 
      style={{ 
        padding: "20px", 
        maxWidth: "1200px", 
        margin: "0", 
        fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        WebkitFontSmoothing: "antialiased",
        textAlign: "left",
        color: "#000"
      }}
      className="notranslate"
      translate="no"
    >
      
      <div style={{ marginBottom: "40px" }}>
        <h1 style={{ fontSize: "32px", fontWeight: "bold", margin: "0 0 20px 0", color: "#000" }}>2026년 코지하우스 매장별 전용상품 리포트</h1>
        <div style={{ display: "flex", justifyContent: "flex-end", width: "100%" }}>
          <button onClick={saveAllStoresToServer} style={{ padding: "12px 30px", borderRadius: "8px", border: "none", backgroundColor: "#007bff", color: "white", cursor: "pointer", fontSize: "15px", display: "flex", alignItems: "center", gap: "8px", boxShadow: "0 2px 5px rgba(0,123,255,0.3)" }}>☁️ 서버 저장(관리자용)</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: "20px", marginBottom: "20px", flexWrap: "wrap" }}>
        <div style={uploadCardStyle(Object.keys(allMonthsMaster).length > 0)}>
          {Object.keys(allMonthsMaster).length > 0 && (
            <div style={{ position: "absolute", top: "16px", right: "16px" }}><button onClick={() => setAllMonthsMaster({})} style={deleteButtonStyle}>🗑️ 삭제</button></div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "15px" }}>
            <div style={{ width: "28px", height: "28px", borderRadius: "50%", border: Object.keys(allMonthsMaster).length > 0 ? "none" : "2px solid #ccc", backgroundColor: Object.keys(allMonthsMaster).length > 0 ? "#2e7d32" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>{Object.keys(allMonthsMaster).length > 0 ? "✓" : ""}</div>
            <h3 style={{ margin: 0, fontWeight: "bold", fontSize: "18px", color: "#000" }}>1. 전용상품 현황 업로드 (관리자용)</h3>
          </div>
          <input type="file" accept=".xlsx,.xls" onChange={handleMasterUpload} style={{ display: "block", width: "100%" }} />
        </div>

        <div style={uploadCardStyle(Object.keys(allMonthsOrder).length > 0)}>
          {Object.keys(allMonthsOrder).length > 0 && (
            <div style={{ position: "absolute", top: "16px", right: "16px" }}><button onClick={() => {setAllMonthsOrder({}); setStoreNames([]); setSelectedStore("");}} style={deleteButtonStyle}>🗑️ 삭제</button></div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "15px" }}>
            <div style={{ width: "28px", height: "28px", borderRadius: "50%", border: Object.keys(allMonthsOrder).length > 0 ? "none" : "2px solid #ccc", backgroundColor: Object.keys(allMonthsOrder).length > 0 ? "#2e7d32" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>{Object.keys(allMonthsOrder).length > 0 ? "✓" : ""}</div>
            <h3 style={{ margin: 0, fontWeight: "bold", fontSize: "18px", color: "#000" }}>2. 매장별 상품내역 업로드 (관리자용)</h3>
          </div>
          <input type="file" accept=".xlsx,.xls" onChange={handleOrderUpload} style={{ display: "block", width: "100%" }} />
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", gap: "25px", flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <h3 style={{ margin: "0 0 8px 0", fontWeight: "bold", fontSize: "18px", color: "#000" }}>📍 매장 선택</h3>
            <select value={selectedStore} onChange={(e) => setSelectedStore(e.target.value)} style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #ccc", minWidth: "240px", color: "#000" }}>
              <option value="">매장을 선택하세요</option>
              {storeNames.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div>
            <h3 style={{ margin: "0 0 8px 0", fontWeight: "bold", fontSize: "18px", color: "#000" }}>🗓️ 월 선택</h3>
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} disabled={!selectedStore} style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid #ccc", minWidth: "140px", backgroundColor: !selectedStore ? "#f5f5f5" : "white", color: "#000" }}>
              <option value="전체">전체</option>
              {Array.from({ length: 12 }, (_, i) => `${i + 1}월`).map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <button onClick={downloadExcelReport} style={{ padding: "10px 22px", borderRadius: "8px", border: "none", backgroundColor: "#2e7d32", color: "white", cursor: "pointer" }}>📥 엑셀 다운로드</button>
        </div>
      </div>

      {summary && (
        <div style={cardStyle}>
          <h2 style={{ marginTop: 0, fontWeight: "bold", fontSize: "22px", color: "#000" }}>매장 요약 지표 - {selectedStore} / {selectedMonth}</h2>
          <div style={{ height: "20px" }}></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "15px" }}>
            <div style={{ minWidth: "180px" }}><div style={{ fontSize: "14px", color: "#555" }}>전용상품 (전체 기준)</div><div style={{ fontSize: "24px", fontWeight: "bold", color: "#000" }}>{summary.totalExclusiveInMaster} 개</div></div>
            <div style={{ minWidth: "180px" }}><div style={{ fontSize: "14px", color: "#555" }}>사용한 전용상품(종류)</div><div style={{ fontSize: "24px", fontWeight: "bold", color: "#000" }}>{summary.usedExclusiveCount} 개</div></div>
            <div style={{ minWidth: "180px" }}><div style={{ fontSize: "14px", color: "#555" }}>미사용 전용상품</div><div style={{ fontSize: "24px", fontWeight: "bold", color: "#d32f2f" }}>{summary.unusedExclusiveCount} 개</div></div>
            <div style={{ minWidth: "200px" }}><div style={{ fontSize: "14px", color: "#555" }}>전용상품 사용 비율</div><div style={{ fontSize: "24px", fontWeight: "bold", color: "#000" }}>{summary.exclusiveUsageRate}%</div></div>
          </div>
        </div>
      )}

      {selectedStore && (
        <>
          <div style={cardStyle}>
            <h2 style={{ fontWeight: "bold", fontSize: "24px", color: "#000", marginBottom: "0" }}>리포트 1. 매장 전용상품 내역 - {reportExclusiveRows.length}개</h2>
            <div style={{ height: "20px" }}></div>
            <div style={{ width: "100%", overflowX: "auto", borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.06)", backgroundColor: "#ffffff" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px", color: "#000" }}>
                <thead>
                  <tr><th style={headerCellStyle}>매장명</th><th style={headerCellStyle}>상품명</th><th style={headerCellStyle}>수량</th><th style={headerCellStyle}>단위</th><th style={headerCellStyle}>중요도</th></tr>
                </thead>
                <tbody>
                  {reportExclusiveRows.map((row, idx) => (
                    <tr key={idx}>
                      <td style={{ ...cellStyle, backgroundColor: "#fff9c4" }}>{row.매장명}</td>
                      <td style={{ ...cellStyle, backgroundColor: "#fff9c4", textAlign: "left", whiteSpace: "normal" }}>{row.상품명}</td>
                      <td style={{ ...cellStyle, backgroundColor: "#fff9c4" }}>{row.수량.toLocaleString()}</td>
                      <td style={{ ...cellStyle, backgroundColor: "#fff9c4" }}>{row.단위}</td>
                      <td style={{ ...cellStyle, backgroundColor: getImportanceColor(row.중요도) }}>{row.중요도}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={cardStyle}>
            <h2 style={{ fontWeight: "bold", fontSize: "24px", color: "#000", marginBottom: "0" }}>리포트 2. 이번 달에 사용하지 않은 전용상품 - {unusedRows.length}개</h2>
            <div style={{ height: "20px" }}></div>
            <div style={{ width: "100%", overflowX: "auto", borderRadius: "12px", boxShadow: "0 4px 12px rgba(0,0,0,0.06)", backgroundColor: "#ffffff" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px", color: "#000" }}>
                <thead>
                  <tr><th style={headerCellStyle}>상품명</th><th style={headerCellStyle}>전용유무</th><th style={headerCellStyle}>중요도</th></tr>
                </thead>
                <tbody>
                  {unusedRows.map((row, idx) => (
                    <tr key={idx} style={{ backgroundColor: "#ffe6e6" }}>
                      <td style={{ ...cellStyle, textAlign: "left", whiteSpace: "normal" }}>{row.상품명}</td>
                      <td style={cellStyle}>{row.전용유무}</td>
                      <td style={cellStyle}>{row.중요도}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;