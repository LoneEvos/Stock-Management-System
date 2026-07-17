// Template di-mount ulang pada SETIAP navigasi (beda dengan layout) —
// seksi-seksi halaman naik berurutan (stagger fade-up) ala StokTrace.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="stagger-up">{children}</div>;
}
