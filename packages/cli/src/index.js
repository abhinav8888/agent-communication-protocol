#!/usr/bin/env node

import { Command } from 'commander';
import { relayCommand } from './relay.js';
import { joinCommand } from './join.js';

const program = new Command();
program
  .name('agent-protocol')
  .description('Communication protocol for Claude Code instances')
  .version('1.0.0');

program.addCommand(relayCommand);
program.addCommand(joinCommand);
program.parse();
