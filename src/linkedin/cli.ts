#!/usr/bin/env node
import { emitError, log } from './io.ts';

const COMMANDS = [
  'login',
  'check',
  'daemon',
  'get-inbox',
  'get-conversation',
  'get-person-profile',
  'send-message',
  'connect',
  'search-people',
  'search-jobs',
  'get-company-profile',
  'get-company-posts',
  'get-job-details',
] as const;

type Command = (typeof COMMANDS)[number];

async function main() {
  const [, , raw, ...rest] = process.argv;
  if (!raw || raw === '--help' || raw === '-h') {
    log('Usage: npx tsx src/linkedin/cli.ts <command> [--flag value ...]');
    log('Commands:', COMMANDS.join(', '));
    process.exit(raw ? 0 : 1);
  }
  const cmd = raw as Command;
  if (!COMMANDS.includes(cmd)) {
    emitError(`Unknown command: ${raw}`, `Valid: ${COMMANDS.join(', ')}`);
  }

  switch (cmd) {
    case 'login': {
      const { runLogin } = await import('./commands/login.ts');
      await runLogin();
      break;
    }
    case 'check': {
      const { runCheck } = await import('./commands/check.ts');
      await runCheck();
      break;
    }
    case 'daemon': {
      const { runDaemon } = await import('./commands/daemon.ts');
      await runDaemon(rest);
      break;
    }
    case 'get-inbox': {
      const { runGetInbox } = await import('./commands/get-inbox.ts');
      await runGetInbox(rest);
      break;
    }
    case 'get-conversation': {
      const { runGetConversation } = await import('./commands/get-conversation.ts');
      await runGetConversation(rest);
      break;
    }
    case 'get-person-profile': {
      const { runGetPersonProfile } = await import('./commands/get-person-profile.ts');
      await runGetPersonProfile(rest);
      break;
    }
    case 'send-message': {
      const { runSendMessage } = await import('./commands/send-message.ts');
      await runSendMessage(rest);
      break;
    }
    case 'connect': {
      const { runConnect } = await import('./commands/connect.ts');
      await runConnect(rest);
      break;
    }
    case 'search-people': {
      const { runSearchPeople } = await import('./commands/search-people.ts');
      await runSearchPeople(rest);
      break;
    }
    case 'search-jobs': {
      const { runSearchJobs } = await import('./commands/search-jobs.ts');
      await runSearchJobs(rest);
      break;
    }
    case 'get-company-profile': {
      const { runGetCompanyProfile } = await import('./commands/get-company-profile.ts');
      await runGetCompanyProfile(rest);
      break;
    }
    case 'get-company-posts': {
      const { runGetCompanyPosts } = await import('./commands/get-company-posts.ts');
      await runGetCompanyPosts(rest);
      break;
    }
    case 'get-job-details': {
      const { runGetJobDetails } = await import('./commands/get-job-details.ts');
      await runGetJobDetails(rest);
      break;
    }
    default:
      emitError(`Command not yet implemented: ${cmd}`);
  }
}

main().catch((e) => emitError(e));
