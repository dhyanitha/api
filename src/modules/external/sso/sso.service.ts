import { Component } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { IAuthenticationResponse, IAuthenticationVerify } from './sso.interface';
import { CacheService } from '../../cache/cache.service';
import * as moment from 'moment';
import { TokenExpiredException } from './sso.exceptions';

@Component()
export class SSOService {

  private baseUrl = 'https://login.eveonline.com/oauth/';
  private userAgent = `eve-book/${process.env.npm_package_version} https://github.com/evebook/api`;
  private client: AxiosInstance;

  private authenticationRedirect = <string>process.env.ESI_REDIRECT;
  private clientId = <string>process.env.ESI_CLIENT;
  private secretKey = <string>process.env.ESI_SECRET;
  private scope = <string>process.env.ESI_SCOPE;

  constructor(private cacheService: CacheService) {
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'User-Agent': this.userAgent,
        Accept: 'application/json',
      },
    });
  }

  /**
   * Get authorization header for verifying authentication
   * @return {string}
   */
  private get authorizationHeader() {
    return 'Basic ' + new Buffer(this.clientId + ':' + this.secretKey).toString('base64');
  }

  /**
   * Get authentication url
   * @return {string}
   */
  public get authenticationUrl() {
    return this.baseUrl + 'authorize/'
      + '?response_type=code'
      + `&redirect_uri=${this.authenticationRedirect}`
      + `&client_id=${this.clientId}`
      + `&scope=${this.scope}`;
    // TODO + `&state=someRandomThingThatWeCanVerify
  }

  /**
   * Get authentication access token
   * @param state
   * @param code
   * @return {Promise<IAuthenticationResponse>}
   */
  public async getAuthenticationToken(
    state: string,
    code: string,
  ): Promise<IAuthenticationResponse> {
    const response = await this.client.request({
      url: 'token/',
      method: 'POST',
      params: {
        code,
        grant_type: 'authorization_code',
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: this.authorizationHeader,
      },
    });

    return response.data;
  }

  /**
   * Use refresh token to obtain new access token
   * @param refreshToken
   * @return {Promise<IAuthenticationResponse>}
   */
  public async refreshToken(refreshToken: string): Promise<IAuthenticationResponse> {
    const response = await this.client.request({
      url: 'token/',
      method: 'POST',
      params: {
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: this.authorizationHeader,
      },
    });

    return response.data;
  }

  /**
   * Use to check if token is valid
   * @param token
   * @return {Promise<IAuthenticationVerify>}
   */
  public async verifyAuthentication(token: string): Promise<IAuthenticationVerify> {

    // Check in cache if we have response already
    if (await this.cacheService.exists(token)) {
      return this.cacheService.fetch<IAuthenticationVerify>(token);
    }

    try {
      const response = await this.client.request({
        url: 'verify/',
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      // Get expiration date
      const expiresIn = moment.utc(response.data.ExpiresOn).diff(moment(), 'seconds');

      // Store response data to cache
      await this.cacheService.store(token, response.data, expiresIn);

      return response.data;
    } catch (err) {
      // Check if we caught axios 400 error
      if (err.response && err.response.status === 400) {
        // TODO: Should we rather throw TokenInvalidException() ?
        throw new TokenExpiredException();
      }
      else throw err;
    }
  }

}
