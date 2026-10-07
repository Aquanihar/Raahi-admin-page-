import './globals.css';

export const metadata = {
  title: 'Raahi Admin — Identity & License Verification Portal',
  description: 'Independent Verification Portal for Raahi Carpool Document Reviews',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
