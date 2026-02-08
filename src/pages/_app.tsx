import { UserProvider } from '@auth0/nextjs-auth0/client';
// ...existing imports...

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <UserProvider>
      <Component {...pageProps} />
    </UserProvider>
  );
}

export default MyApp;
