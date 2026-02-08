import { useUser } from '@auth0/nextjs-auth0/client';

export default function LoginButton() {
  const { user, error, isLoading } = useUser();

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>{error.message}</div>;

  if (user) {
    return (
      <div>
        <span>Welcome {user.name}!</span>
        <a href="/api/auth/logout">Logout</a>
      </div>
    );
  }

  return <a href="/api/auth/login">Login</a>;
}
