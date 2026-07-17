// Template di-mount ulang pada SETIAP navigasi (beda dengan layout) —
// dipakai untuk animasi masuk fade-up ala StokTrace di semua halaman.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade-up">{children}</div>;
}
