// Only the isolated US test project is enabled. Never place the public waitlist project here.
const testProject = Object.freeze({
  url: 'https://njaoyeiuericdxaqpghm.supabase.co',
  key: 'sb_publishable_5GJLs6D90g-DNvHiJWJZYQ_4hdV7MB1',
  emailCodesReady: false
});
export const pilotProjects = Object.freeze({
  '127.0.0.1': testProject,
  'localhost': testProject,
  'grociq-git-feat-us-couples-pilot-shivankkanitkar2027-9139.vercel.app': testProject
});

export function resolvePilotConfig(hostname, projects = pilotProjects) {
  if (!Object.hasOwn(projects, hostname)) return null;
  const project = projects[hostname];
  if (!project || typeof project.url !== 'string' || typeof project.key !== 'string') return null;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(project.url) || !project.key.trim()) return null;
  return { url: project.url, key: project.key, emailCodesReady: project.emailCodesReady === true };
}
