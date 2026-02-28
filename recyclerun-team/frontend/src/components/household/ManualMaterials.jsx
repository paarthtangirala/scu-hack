/**
 * Manual material picker for household posting.
 * Owner: Anisha
 */
import { useState } from 'react';
import { MATERIAL_RATES } from '../../services/demoData';

export function ManualMaterials({ onChange }) {
  const [items, setItems] = useState([]);

  function add() {
    const newItems = [...items, { id: Date.now(), type: 'cardboard', lbs: 0 }];
    setItems(newItems); onChange?.(newItems);
  }

  function update(id, field, val) {
    const updated = items.map(i => i.id === id ? { ...i, [field]: val } : i);
    setItems(updated); onChange?.(updated);
  }

  function remove(id) {
    const filtered = items.filter(i => i.id !== id);
    setItems(filtered); onChange?.(filtered);
  }

  return (
    <div>
      {items.map(item => (
        <div key={item.id} style={{ display:'flex', gap:'0.5rem', marginBottom:'0.5rem', alignItems:'center' }}>
          <select style={{ flex:2 }} value={item.type} onChange={e => update(item.id, 'type', e.target.value)}>
            {Object.entries(MATERIAL_RATES).map(([k, v]) =>
              <option key={k} value={k}>{v.emoji} {v.label}</option>)}
          </select>
          <input type="number" style={{ flex:1 }} placeholder="lbs" min="0" step="0.5"
            onChange={e => update(item.id, 'lbs', parseFloat(e.target.value) || 0)} />
          <button className="btn" style={{ background:'rgba(255,71,87,0.1)', color:'var(--red)',
            border:'1px solid rgba(255,71,87,0.2)', padding:'0.5rem 0.75rem' }}
            onClick={() => remove(item.id)}>✕</button>
        </div>
      ))}
      <button className="btn btn-secondary btn-full" onClick={add} style={{ marginBottom:'1.25rem' }}>
        + Add material manually
      </button>
    </div>
  );
}
