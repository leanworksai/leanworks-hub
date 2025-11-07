import express from 'express';
import cors from 'cors';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as serviceAccount from '../gcp_credential.json';

// Initialize Firebase Admin SDK
if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount as any),
    projectId: serviceAccount.project_id,
  });
}

const db = getFirestore(undefined, 'leanworks-test');
const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// Helper to convert Firestore timestamps
const convertDoc = (doc: any) => {
  const data = doc.data();
  if (!data) return null;
  
  // Convert Firestore timestamps
  const converted: any = {};
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'toDate' in value) {
      const date = (value as any).toDate();
      // For createdAt, preserve as timestamp in milliseconds
      if (key === 'createdAt') {
        converted[key] = date.getTime();
      } else {
        // For other date fields, convert to date string
        converted[key] = date.toISOString().split('T')[0];
      }
    } else {
      converted[key] = value;
    }
  }
  return converted;
};

// Projects endpoints
app.get('/api/projects', async (req, res) => {
  try {
    const snapshot = await db.collection('projects').get();
    const projects = snapshot.docs.map(doc => convertDoc(doc));
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/projects/:name', async (req, res) => {
  try {
    const doc = await db.collection('projects').doc(req.params.name).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(convertDoc(doc));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/projects', async (req, res) => {
  try {
    const project = req.body;
    await db.collection('projects').doc(project.name).set(project);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.patch('/api/projects/:name', async (req, res) => {
  try {
    await db.collection('projects').doc(req.params.name).update(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/projects/:name', async (req, res) => {
  try {
    await db.collection('projects').doc(req.params.name).delete();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Tasks endpoints
app.get('/api/tasks', async (req, res) => {
  try {
    const snapshot = await db.collection('tasks').get();
    const tasks = snapshot.docs.map(doc => convertDoc(doc));
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/tasks/:id', async (req, res) => {
  try {
    const doc = await db.collection('tasks').doc(req.params.id).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(convertDoc(doc));
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/tasks/project/:projectId', async (req, res) => {
  try {
    const snapshot = await db.collection('tasks')
      .where('projectId', '==', req.params.projectId)
      .get();
    const tasks = snapshot.docs.map(doc => convertDoc(doc));
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const task = req.body;
    await db.collection('tasks').doc(task.id).set(task);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.patch('/api/tasks/:id', async (req, res) => {
  try {
    await db.collection('tasks').doc(req.params.id).update(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    await db.collection('tasks').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Teams endpoints
app.get('/api/teams', async (req, res) => {
  try {
    const snapshot = await db.collection('teams').get();
    const teams = snapshot.docs.map(doc => doc.data());
    res.json(teams);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/teams/:name', async (req, res) => {
  try {
    const doc = await db.collection('teamDetails').doc(req.params.name).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Team not found' });
    }
    res.json(doc.data());
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.post('/api/teams', async (req, res) => {
  try {
    const { team, teamDetail } = req.body;
    await db.collection('teams').doc(team.name).set(team);
    await db.collection('teamDetails').doc(team.name).set(teamDetail);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.patch('/api/teams/:name', async (req, res) => {
  try {
    await db.collection('teams').doc(req.params.name).update(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.patch('/api/teams/:name/detail', async (req, res) => {
  try {
    await db.collection('teamDetails').doc(req.params.name).update(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.delete('/api/teams/:name', async (req, res) => {
  try {
    await db.collection('teams').doc(req.params.name).delete();
    await db.collection('teamDetails').doc(req.params.name).delete();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Firestore proxy server running on http://0.0.0.0:${PORT}`);
  console.log(`📊 Using project: ${serviceAccount.project_id}`);
  console.log(`🗄️  Database: leanworks-test`);
});

