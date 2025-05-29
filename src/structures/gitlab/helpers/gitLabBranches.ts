// src/structures/gitlab/helpers/gitlabBranches.ts

import { Branch, Config } from '@/src/types'
import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as path from 'path'
import * as fs from 'fs'
import { GitbeakerRequestError } from '@gitbeaker/requester-utils'

export class gitlabBranchHelper {
  private repoPath: string | null = null

  constructor(
    private gitlab: any,
    private config: Config,
    private getProjectId: () => Promise<number>
  ) {}

  private getRepoPathFromConfig(): string | null {
    if (this.config.gitlab?.projectId) {
      return null
    }

    const owner = this.config.gitlab.owner
    const repo = this.config.gitlab.repo

    if (owner && repo) {
      return `${owner}/${repo}`
    }

    return null
  }

  async sync(): Promise<Branch[]> {
    try {
      core.info('\x1b[36m🌿 Fetching GitLab Branches...\x1b[0m')

      const projectId = await this.getProjectId()
      const branches = await this.gitlab.Branches.all(projectId)
      // Extract repo path from first branch API URL
      if (branches.length > 0 && !this.repoPath) {
        const apiUrl = branches[0]._links?.self || ''
        const match = apiUrl.match(/projects\/(.+?)\/repository/)
        if (match) {
          this.repoPath = decodeURIComponent(match[1])
          core.debug(`Extracted repo path: ${this.repoPath}`)
        }
      }

      interface GitLabBranch {
        name: string
        commit: { id: string }
        protected: boolean
      }

      const processedBranches: Branch[] = branches
        .filter(
          (branch: GitLabBranch) =>
            this.config.gitlab.sync?.branches.protected || !branch.protected
        )
        .map((branch: GitLabBranch) => ({
          name: branch.name,
          sha: branch.commit.id,
          protected: branch.protected
        }))

      core.info(
        `\x1b[32m✓ Branches Fetched: ${processedBranches.length} branches (${processedBranches.map((branch: Branch) => branch.name).join(', ')})\x1b[0m`
      )
      return processedBranches
    } catch (error) {
      if (error instanceof Error) {
        core.warning(
          `\x1b[31m❌ Failed to Fetch GitLab Branches: ${error.message}\x1b[0m`
        )
      } else {
        core.warning(
          `\x1b[31m❌ Failed to Fetch GitLab Branches: ${String(error)}\x1b[0m`
        )
      }
      return []
    }
  }

  async update(name: string, commitSha: string): Promise<void> {
    try {
      // Try getting path from  sync first
      if (!this.repoPath) {
        await this.sync()
      }
      if (!this.repoPath) {
        // If still no path, try getting path from config as last resort
        this.repoPath = this.getRepoPathFromConfig()

        if (!this.repoPath) {
          throw new Error('Could not determine repository path')
        }
      }

      const gitlabUrl = this.config.gitlab.host || 'https://gitlab.com'
      const repoPath = `${gitlabUrl}/${this.repoPath}.git`
      const tmpDir = path.join(process.cwd(), '.tmp-git')
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true })
      }

      await exec.exec('git', ['init'], { cwd: tmpDir })
      await exec.exec('git', ['config', 'user.name', 'advanced-git-sync'], {
        cwd: tmpDir
      })
      await exec.exec(
        'git',
        ['config', 'user.email', 'advanced-git-sync@users.noreply.github.com'],
        { cwd: tmpDir }
      )

      const githubUrl = `https://x-access-token:${this.config.github.token}@github.com/${this.config.github.owner}/${this.config.github.repo}.git`
      await exec.exec('git', ['remote', 'add', 'gitHub', githubUrl], {
        cwd: tmpDir
      })

      await exec.exec('git', ['fetch', 'gitHub', commitSha], { cwd: tmpDir })

      const gitlabAuthUrl = `https://oauth2:${this.config.gitlab.token}@${repoPath.replace('https://', '')}`
      await exec.exec('git', ['remote', 'add', 'gitlab', gitlabAuthUrl], {
        cwd: tmpDir
      })

      await exec.exec(
        'git',
        ['push', 'gitlab', `${commitSha}:refs/heads/${name}`],
        { cwd: tmpDir }
      )

      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (error) {
      throw new Error(
        `Failed to update branch ${name}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  async create(name: string, commitSha: string): Promise<void> {
    await this.update(name, commitSha)
  }
}
