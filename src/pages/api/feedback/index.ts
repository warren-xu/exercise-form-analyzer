import { withApiAuthRequired, getSession } from '@auth0/nextjs-auth0';
import type { NextApiRequest, NextApiResponse } from 'next';

export default withApiAuthRequired(async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getSession(req, res);
  const userId = session?.user.sub;

  if (req.method === 'POST') {
    // Save feedback for userId
    const { exerciseId, feedback } = req.body;
    // TODO: Store in database with userId
    return res.status(200).json({ success: true, userId });
  }

  if (req.method === 'GET') {
    // Get feedback for userId
    // TODO: Retrieve from database
    return res.status(200).json({ userId, feedback: [] });
  }

  res.status(405).json({ error: 'Method not allowed' });
});
