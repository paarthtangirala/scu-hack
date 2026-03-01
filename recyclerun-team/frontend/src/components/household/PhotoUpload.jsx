/**
 * Photo upload + AMD AI classification component.
 * Owner: Anisha
 */
import { useState, useRef } from 'react';
import { api } from '../../services/api';
import { DEMO_CLASSIFICATION, MATERIAL_RATES } from '../../services/demoData';
import { normalizeLbs, safeClassifyMaterials } from '../../services/uploadPipeline';
import { Spinner } from '../ui/Spinner';
import { Tag } from '../ui/Tag';

export function PhotoUpload({ onResult }) {
  const [preview, setPreview] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState(null);
  const inputRef = useRef();

  async function downscaleToJpeg(dataUrl, { maxSide = 1024, quality = 0.85 } = {}) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = img.width || 1;
        const h = img.height || 1;
        const scale = Math.min(1, maxSide / Math.max(w, h));
        const outW = Math.max(1, Math.round(w * scale));
        const outH = Math.max(1, Math.round(h * scale));

        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, outW, outH);

        // Always send JPEG to keep backend AMD payload consistent (`data:image/jpeg;base64,...`).
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(dataUrl); // fallback: send original
      img.src = dataUrl;
    });
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const raw = ev.target.result;
      const dataUrl = await downscaleToJpeg(raw, { maxSide: 1024, quality: 0.85 });
      setPreview(dataUrl);
      setScanning(true);
      const res = await api.classifyImage(dataUrl);
      const canonicalMaterials = safeClassifyMaterials(res);
      const rawMaterials = Array.isArray(res?.data?.materials) ? res.data.materials : [];
      const source = res?.ok ? (res?.data?.source || 'amd') : DEMO_CLASSIFICATION.source;
      const displayMaterials = rawMaterials
        .map((m) => {
          const type = typeof m?.type === 'string' ? m.type : '';
          if (!type) return null;
          const lbs = normalizeLbs(m?.lbs ?? m?.weight_lbs);
          if (lbs <= 0) return null;
          const rate = MATERIAL_RATES[type]?.rate || 0;
          const fallbackValue = Math.round(lbs * rate * 100) / 100;
          const value = Number.isFinite(Number(m?.value)) ? Number(m.value) : fallbackValue;
          return {
            ...m,
            type,
            lbs,
            value,
            label: m?.label || MATERIAL_RATES[type]?.label || type,
            emoji: m?.emoji || MATERIAL_RATES[type]?.emoji || '♻️',
            confidence: Number.isFinite(Number(m?.confidence)) ? Number(m.confidence) : 0.8,
          };
        })
        .filter(Boolean);
      const total_lbs = Math.round(displayMaterials.reduce((sum, m) => sum + m.lbs, 0) * 10) / 10;
      const total_value = Math.round(displayMaterials.reduce((sum, m) => sum + m.value, 0) * 100) / 100;
      const final = {
        success: !!res?.ok,
        source,
        materials: displayMaterials,
        total_lbs,
        total_value,
        notes: res?.data?.notes || '',
      };
      setResult(final);
      setScanning(false);
      onResult?.(canonicalMaterials);
    };
    reader.readAsDataURL(file);
  }

  function clear() {
    setPreview(null); setResult(null);
    if (inputRef.current) inputRef.current.value = '';
    onResult?.([]);
  }

  return (
    <div>
      {!preview ? (
        <div className="upload-zone" onClick={() => inputRef.current?.click()}>
          <input ref={inputRef} type="file" accept="image/*" onChange={handleFile}
            style={{ display:'none' }} />
          <div style={{ fontSize:'3rem', marginBottom:'1rem' }}>📸</div>
          <div style={{ fontWeight:700, marginBottom:'0.5rem' }}>Drop photo or tap to upload</div>
          <div style={{ color:'var(--muted)', fontFamily:'var(--mono)', fontSize:'0.85rem' }}>
            Cardboard, cans, bottles, e-waste, metals & more
          </div>
        </div>
      ) : (
        <div>
          <img src={preview} style={{ width:'100%', borderRadius:'12px',
            maxHeight:'280px', objectFit:'cover', marginBottom:'1rem' }} />
          <button className="btn btn-secondary btn-full" onClick={clear}>✕ Remove photo</button>
        </div>
      )}

      {scanning && (
        <div style={{ textAlign:'center', padding:'2rem' }}>
          <Spinner size={32} /><br/>
          <span style={{ fontFamily:'var(--mono)', fontSize:'0.85rem', color:'var(--muted)', marginTop:'0.75rem', display:'block' }}>
            Analyzing materials with AMD AI...
          </span>
        </div>
      )}

      {result && !scanning && (
        <div style={{ marginTop:'1rem' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem' }}>
            <span style={{ fontSize:'0.78rem', fontWeight:700, color:'var(--muted)', fontFamily:'var(--mono)', letterSpacing:'0.05em' }}>AI SCAN RESULTS</span>
            <Tag color={result.source === 'amd' ? 'green' : result.source === 'claude' ? 'green' : 'amber'}>
              {result.source === 'amd' ? '✓ AMD Vision' : result.source === 'claude' ? '✓ Backup Vision' : 'Demo mode'}
            </Tag>
          </div>
          {(result.materials || []).map((m, i) => (
            <div key={i} className="material-row">
              <div className="material-info">
                <span className="material-emoji">{m.emoji || MATERIAL_RATES[m.type]?.emoji || '♻️'}</span>
                <div>
                  <div className="material-name">{m.label}</div>
                  <div className="material-weight">~{m.lbs} lbs · {Math.round((m.confidence||0.8)*100)}% confidence</div>
                </div>
              </div>
              <div className="material-value">${m.value.toFixed(2)}</div>
            </div>
          ))}
          <div className="value-summary">
            <div>
              <div style={{ fontSize:'0.72rem', color:'var(--muted)', fontFamily:'var(--mono)' }}>ESTIMATED TOTAL</div>
              <div style={{ fontFamily:'var(--mono)', fontSize:'1.8rem', color:'var(--green)', fontWeight:500 }}>
                ${result.total_value.toFixed(2)}
              </div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:'0.72rem', color:'var(--muted)', fontFamily:'var(--mono)' }}>TOTAL WEIGHT</div>
              <div style={{ fontFamily:'var(--mono)', fontSize:'1.1rem' }}>{result.total_lbs} lbs</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
