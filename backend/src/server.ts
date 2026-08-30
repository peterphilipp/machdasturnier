import 'express-async-errors'; // Must be at the very top for async error catching
import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from './config/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Route imports
import tournamentRoutes from './routes/tournament.routes.js';
import groupRoutes from './routes/group.routes.js';
import teamRoutes from './routes/team.routes.js';
import matchRoutes from './routes/match.routes.js';
import volunteerRoutes from './routes/volunteer.routes.js';
import passkeyRoutes from './routes/passkey.routes.js';
import shoppingListRoutes from './routes/shoppingList.routes.js';
import shiftRoutes from './routes/shift.routes.js';
import volunteerShiftRoutes from './routes/volunteerShift.routes.js';
import shiftOfferRoutes from './routes/shiftOffer.routes.js';
import workAreaRoutes from './routes/workArea.routes.js';
import materialRoutes from './routes/material.routes.js';
import healthRoutes from './routes/health.routes.js';
import environmentRoutes from './routes/environment.routes.js';
import aenderungRoutes from './routes/aenderung.routes.js';
import passwordRoutes from './routes/password.routes.js';
import clubRoutes from './routes/club.routes.js';
import selfRoutes from './routes/self.routes.js';
import foodRoutes from './routes/food.routes.js';
import foodDonationSlotRoutes from './routes/foodDonationSlot.routes.js';
import yearGroupRoutes from './routes/yearGroup.routes.js';
import timeSlotRoutes from './routes/timeslot.routes.js';
import fieldRoutes from './routes/field.routes.js';
import standingsRoutes from './routes/standings.routes.js';
import knockoutBracketRoutes from './routes/knockoutBracket.routes.js';
import tournamentClubRoutes from './routes/tournamentClub.routes.js';
import impactRoutes from './routes/impact.routes.js';
import dayTemplateRoutes from './routes/dayTemplate.routes.js';
import tournamentWorkAreaRoutes from './routes/tournamentWorkArea.routes.js';
import tournamentDayRoutes from './routes/tournamentDay.routes.js';
import daySlotRoutes from './routes/daySlot.routes.js';
import workAreaCategoryRoutes from './routes/workAreaCategory.routes.js';
import adminRoutes from './routes/admin.routes.js';
// Middleware imports
import errorHandler from './middleware/errorHandler.js';
import { securityHeaders, corsMiddleware, globalLimiter } from './middleware/security.js';
// Scheduler
import { startScheduler } from './utils/scheduler.js';

const app = express();

// Hinter dem Reverse-Proxy (Produktion) steht die echte Client-IP in
// X-Forwarded-For. Ohne dies würde das Rate-Limiting alle Nutzer als eine
// einzige IP (die des Proxys) zählen. 1 = nur dem ersten Hop vertrauen.
app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(corsMiddleware);
app.use(globalLimiter);
app.use(express.json({ limit: '10mb' }));

// ===================== Endpoints =====================
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/volunteers', volunteerRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/volunteer-shifts', volunteerShiftRoutes);
app.use('/api/shift-offers', shiftOfferRoutes);
app.use('/api/work-areas', workAreaRoutes);
app.use('/api/material', materialRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/environment', environmentRoutes);
app.use('/api/changes', aenderungRoutes);
app.use('/api/auth', passwordRoutes);
app.use('/api/auth/passkey', passkeyRoutes);
app.use('/api/clubs', clubRoutes);
app.use('/api/self', selfRoutes);
app.use('/api/work-area-categories', workAreaCategoryRoutes);
app.use('/api/knockout-brackets', knockoutBracketRoutes);
app.use('/api/tournament-clubs', tournamentClubRoutes);
app.use('/api/food', foodRoutes);
app.use('/api/food-donation-slots', foodDonationSlotRoutes);
app.use('/api/shopping-list', shoppingListRoutes);
app.use('/api/year-groups', yearGroupRoutes);
app.use('/api/time-slots', timeSlotRoutes);
app.use('/api/fields', fieldRoutes);
app.use('/api/standings', standingsRoutes);
app.use('/api/impact', impactRoutes);
app.use('/api/day-templates', dayTemplateRoutes);
app.use('/api/tournament-work-areas', tournamentWorkAreaRoutes);
app.use('/api/tournament-days', tournamentDayRoutes);
app.use('/api/day-slots', daySlotRoutes);

// Admin-only endpoints (DB management)
app.use('/api/admin', adminRoutes);

// ===================== Serve Frontend (SPA) =====================
const distPath = path.resolve(__dirname, '../dist');
app.use(express.static(distPath, {
  setHeaders: (res, filePath) => {
    // sw.js und index.html müssen bei jedem Request neu vom Server geholt
    // werden (kein Cache dazwischen, auch nicht kurzzeitig) - sonst verzögert
    // ein zwischengespeicherter alter Stand zusätzlich zum eigenen
    // Update-Zyklus des Service Workers das Erkennen eines neuen Deployments.
    // Gehashte Assets (index-XXXX.js) sind davon nicht betroffen und dürfen
    // wie bisher normal gecacht werden.
    if (filePath.endsWith('sw.js') || filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// SPA fallback: alle nicht-API-Routen -> index.html
app.get('*', (req: Request, res: Response) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.resolve(distPath, 'index.html'));
});

// ===================== Error Handling =====================
// This must be registered after all routes
app.use(errorHandler);

// ===================== Server Start & DB-Verbindung =====================
const PORT = process.env.PORT || 5000;

app.listen(PORT, async () => {
  try {
    await prisma.$connect();
    const v = process.env.APP_VERSION || 'dev';
    const sha = process.env.GIT_SHA || 'local';
    console.log(`[OK] Backend v${v} (${sha}) läuft auf Port ${PORT} & DB verbunden`);
    startScheduler();
  } catch (connectionError) {
    console.error('[FATAL ERROR] Datenbankverbindung fehlgeschlagen:', (connectionError as Error).message);
    process.exit(1);
  }
});


process.on('SIGINT', async () => {
  await prisma.$disconnect();
  console.log('DB getrennt - Server gestoppt');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
