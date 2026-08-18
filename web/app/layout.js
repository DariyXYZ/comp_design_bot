import { Golos_Text } from "next/font/google";
import Script from "next/script";
import "./globals.css";

// Раньше шрифт тянулся тремя тегами из fonts.googleapis.com. next/font
// скачивает его на этапе сборки и раздаёт со своего же домена — на один
// внешний хост меньше в Telegram WebView, где сеть часто медленная.
const golos = Golos_Text({
  subsets: ["cyrillic", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-golos",
  display: "swap",
});

export const metadata = {
  title: "Возможности отдела",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru" className={golos.variable}>
      <body>
        {/* beforeInteractive — SDK Telegram обязан существовать до гидратации:
            дека читает window.Telegram.WebApp сразу на маунте, а без него
            sendData недоступен и выбор задачи молча деградирует в alert. */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        {children}
      </body>
    </html>
  );
}
