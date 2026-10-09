// Display copy only. Permission decisions still come from permissions.js and the database.
const labels = {
  'device:list': ['See available devices', 'See the devices you are allowed to access.'],
  'device:view': ['View device details', 'See device information. Starting a view-only session also requires Start sessions.'],
  'device:control': ['Use keyboard and mouse', 'Control a device during a session. Also requires Start sessions.'],
  'device:terminal': ['Use the terminal', 'Run commands during a terminal session. Also requires Start sessions.', true],
  'device:file_transfer': ['Transfer files', 'Send and receive files when the streaming product supports file transfer.'],
  'device:provision': ['Add or remove devices', 'Register devices, move them between companies, or remove them.', true],
  'device:update': ['Update devices', 'Rename devices and update their information.'],
  'session:start': ['Start sessions', 'Start a session on an allowed device. The viewing or control action must also be allowed.'],
  'session:view': ['See the sessions list', 'See session records and their current status. This does not grant keyboard or mouse control.'],
  'session:terminate': ['End other people’s sessions', 'Stop a session started by another member.', true],
  'grant:create': ['Give or block access', 'Create additional access rules for other members. You cannot give access you do not hold.', true],
  'grant:revoke': ['Remove access rules', 'Remove an additional Allow or Block rule. Access from the member’s role still applies.', true],
  'user:read': ['See team members', 'See the member list, profiles, and access rules.'],
  'user:invite': ['Invite teammates', 'Invite a person to join this company.'],
  'user:role:update': ['Change member roles', 'Change another member’s role, within your own management authority.', true],
  'user:remove': ['Suspend or remove members', 'Stop a member’s access to this company and its active sessions.', true],
  'audit:read': ['Read activity history', 'See recorded access attempts and administration changes.'],
  'org:update': ['Update the company', 'Change the company name and settings.'],
  'org:delete': ['Delete the company', 'Close the company workspace and end its members’ access.', true],
};

const groups = { device: 'Devices', session: 'Sessions', grant: 'Access management',
  user: 'Team members', audit: 'Activity history', org: 'Company settings' };
const title = (value) => value.replace(/[_:]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export function permissionLabel(row) {
  const fallbackDescription = row.description && !/^personalised:/i.test(row.description) &&
    !row.description.includes(row.key) ? row.description :
    'A company-specific action added for this workspace.';
  const [label, description, sensitive = false] = labels[row.key] ??
    [title(row.action), fallbackDescription];
  return { ...row, label, description, sensitive, group: groups[row.resource] ?? title(row.resource) };
}
