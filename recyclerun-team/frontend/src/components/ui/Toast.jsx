/** Owner: Anisha */
import { useEffect } from 'react';
export function Toast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div style={{
      position:'fixed', bottom:'2rem', right:'2rem',
      background:'var(--card)', border:'1px solid var(--green)',
      borderRadius:'12px', padding:'1rem 1.5rem',
      fontFamily:'var(--mono)', fontSize:'0.85rem', zIndex:300,
      maxWidth:'360px', animation:'slideIn 0.3s ease',
    }}>
      {message}
    </div>
  );
}
