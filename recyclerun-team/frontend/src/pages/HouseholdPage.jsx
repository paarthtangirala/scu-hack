/** Owner: Anisha */
import { useState } from 'react';
import { PhotoUpload } from '../components/household/PhotoUpload';
import { ManualMaterials } from '../components/household/ManualMaterials';
import { api } from '../services/api';
import { buildListingPayload } from '../services/uploadPipeline';

export function HouseholdPage({ onToast }) {
  const [aiMaterials, setAiMaterials] = useState([]);
  const [manualMats, setManualMats] = useState([]);
  const [form, setForm] = useState({ listing_kind:'household', name:'', address:'', phone:'', notes:'' });

  async function post() {
    if (!form.name || !form.address) { onToast('⚠️ Please enter name and address'); return; }
    const lat = 37.3541 + (Math.random() - 0.5) * 0.05;
    const lng = -121.9552 + (Math.random() - 0.5) * 0.05;
    const payload = buildListingPayload({
      form,
      aiMaterials,
      manualMaterials: manualMats,
      lat,
      lng,
    });
    if (!payload.materials.length) { onToast('⚠️ Add at least one material'); return; }
    const res = await api.createListing(payload);
    if (!res?.ok) {
      onToast(`⚠️ ${res?.error || 'Unable to post listing'}`);
      return;
    }
    onToast('✅ Listing posted! Drivers nearby have been notified.');
    setForm({ listing_kind:'household', name:'', address:'', phone:'', notes:'' }); setAiMaterials([]); setManualMats([]);
  }

  return (
    <div className="content-area">
      <div className="grid-2">
        <div>
          <div className="card mb-2">
            <div className="section-label">STEP 1 — PHOTO (AMD AI)</div>
            <PhotoUpload onResult={setAiMaterials} />
          </div>
        </div>
        <div>
          <div className="card">
            <div className="section-label">STEP 2 — YOUR DETAILS</div>
            <div className="form-group">
              <label>POSTING AS</label>
              <select value={form.listing_kind} onChange={e => setForm({ ...form, listing_kind: e.target.value })}>
                <option value="household">Household</option>
                <option value="business">Small business</option>
              </select>
            </div>
            {['name','address','phone','notes'].map(field => (
              <div className="form-group" key={field}>
                <label>{field.toUpperCase()}</label>
                {field === 'notes'
                  ? <textarea rows={3} value={form[field]} onChange={e => setForm({...form,[field]:e.target.value})} />
                  : <input type="text" value={form[field]} onChange={e => setForm({...form,[field]:e.target.value})} />}
              </div>
            ))}
            <div className="section-label" style={{ marginBottom:'0.75rem' }}>OR ADD MATERIALS MANUALLY</div>
            <ManualMaterials onChange={setManualMats} />
            <button className="btn btn-primary btn-lg btn-full" onClick={post}>🚀 Post Listing to Map</button>
          </div>
        </div>
      </div>
    </div>
  );
}
