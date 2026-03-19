import { handleDemoAction } from '../controllers/demo-controller';

// Using a mock router setup to avoid needing deep dependencies installed
export const applyDemoRoutes = (router: any) => {
  router.get('/logger-demo', handleDemoAction);
};