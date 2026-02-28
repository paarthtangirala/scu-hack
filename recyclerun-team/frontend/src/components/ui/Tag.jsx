/** Owner: Anisha */
export function Tag({ children, color='green' }) {
  return <span className={`tag tag-${color}`}>{children}</span>;
}
