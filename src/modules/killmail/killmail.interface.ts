import { IParticipantResponse } from './participant/participant.interface';

export interface IKillmailResponse {
  id: number;
  url: string;
  victim: IParticipantResponse;
  attackers: IParticipantResponse[];
  locationId: number;
  createdAt: Date;
  totalValue: number;
  npc: boolean;
  warId: number;
}
