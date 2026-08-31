import "./styles.css";

export const metadata = {
  title: "CleanTrack — contractor hours & weekly pay",
  description: "Simple multi-site contractor timesheets and weekly payment totals.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
