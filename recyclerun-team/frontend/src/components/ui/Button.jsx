/** Owner: Anisha */
export function Button({ children, variant='primary', size='', full=false, onClick, disabled, className='' }) {
  const cls = ['btn', `btn-${variant}`, size && `btn-${size}`, full && 'btn-full', className].filter(Boolean).join(' ');
  return <button className={cls} onClick={onClick} disabled={disabled}>{children}</button>;
}
