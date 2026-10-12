// A private pilot project is added here only after its release checks are complete.
// Keep the public waitlist project out of this map.
export const pilotProjects = Object.freeze({});

export function resolvePilotConfig(hostname, projects = pilotProjects) {
  if (!Object.hasOwn(projects, hostname)) return null;
  const project = projects[hostname];
  if (!project || typeof project.url !== 'string' || typeof project.key !== 'string') return null;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(project.url) || !project.key.trim()) return null;
  return { url: project.url, key: project.key };
}
