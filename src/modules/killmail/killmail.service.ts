import { Component } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Repository } from 'typeorm';
import { Killmail } from './killmail.entity';
import { KillmailsStreamService } from '../external/killmailsStream/killmailsStream.service';
import { IKillmailStream } from '../external/killmailsStream/killmailsStream.interface';
import { KillmailParticipantService } from './participant/participant.service';
import { IKillmailResponse } from './killmail.interface';
import { ZKillboardService } from '../external/zkillboard/zkillboard.service';
import { PostService } from '../post/post.service';

@Component()
export class KillmailService {

  constructor(
    private databaseService: DatabaseService,
    private killmailsStreamService: KillmailsStreamService,
    private killmailParticipantService: KillmailParticipantService,
    private postService: PostService,
  ) {
    this.killmailsStreamService.subscribe(this.create.bind(this));
  }

  private get repository(): Promise<Repository<Killmail>> {
    return this.databaseService.getRepository(Killmail);
  }

  /**
   *
   * @param {Killmail} killmail
   * @return {Promise<IKillmailResponse>}
   */
  public async formatKillmailResponse(killmail: Killmail): Promise<IKillmailResponse> {
    const victim = await this.killmailParticipantService
    .formatParticipantResponse(killmail.participants.filter(
      participant => participant.type === 'victim')[0]);

    const attackers = await Promise.all(killmail.participants
    .filter(participant => participant.type === 'attacker')
    .map(killer => this.killmailParticipantService.formatParticipantResponse(killer)));

    return {
      victim,
      attackers,
      id: killmail.id,
      url: ZKillboardService.createKillUrl(killmail.id),
      locationId: killmail.locationId,
      totalValue: killmail.totalValue,
      npc: killmail.npc,
      warId: killmail.warId,
      createdAt: killmail.createdAt,
    };
  }

  /**
   * Create killmail from killmail stream
   * TODO: This should later be moved to separate microservice, that would get jobs from redis.
   * TODO: So that we can run multiple instances of main API
   * @param {KillmailsStream.IKillmailStream} killmailStream
   * @return {Promise<void>}
   */
  private async create(killmailStream: IKillmailStream) {

    if (!killmailStream.victim.id) {
      console.log('skipping killmail - victim has no character id');
    }

    console.info('creating killmail');
    const killmail = new Killmail();
    killmail.id = killmailStream.id;
    killmail.createdAt = killmailStream.date;
    killmail.locationId = killmailStream.locationId;
    killmail.npc = killmailStream.npc;
    killmail.totalValue = killmailStream.totalValue;

    // Create attackers
    await Promise.all(killmailStream.attackers.map((attacker) => {
      if (!attacker.id) return null; // If NPC, ignore
      return this.killmailParticipantService.create(attacker, 'attacker')
      .then(participant => killmail.participants.push(participant));
    }));

    // Create Victims
    await this.killmailParticipantService.create(killmailStream.victim, 'victim')
    .then(participant => killmail.participants.push(participant));

    await (await this.repository).persist(killmail);

    // FIXME: Can it happen that finalBlow is NPC or Structure?
    const finalBlow = killmail.participants.find(participant => participant.finalBlow);

    await this.postService.createKillmailPost(killmail, finalBlow.character);
  }

}
