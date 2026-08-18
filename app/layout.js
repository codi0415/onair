import "./globals.css";

export const metadata = {
  title: "ON AIR — 울산과학고 아침 기상곡 신청",
  description: "울산과학고등학교 방송부 layout이 만든 아침 기상곡 신청 서비스",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
