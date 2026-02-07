import { withPageAuthRequired } from '@auth0/nextjs-auth0/client';

function Dashboard({ user }) {
  return (
    <div>
      <h1>Welcome {user.name}</h1>
      {/* Your protected content here */}
    </div>
  );
}

export default withPageAuthRequired(Dashboard);
