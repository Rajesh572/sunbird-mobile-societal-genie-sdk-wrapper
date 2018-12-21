import { Injectable } from "@angular/core";
import {
    Http,
    Headers,
    RequestOptions,
    RequestMethod
} from "@angular/http";
import { Platform } from "ionic-angular";
import { AuthService } from "./auth.service";
import { BuildParamService } from "../utils/buildparam.service"
import { UserProfileService } from "../userprofile/userprofile.service";
import { UserProfileDetailsRequest } from "../userprofile/bean";

declare var customtabs: {
    isAvailable: (success: () => void, error: (error: string) => void) => void;
    launch: (url: string, success: (callbackUrl: string) => void, error: (error: string) => void) => void;
    close: (success: () => void, error: (error: string) => void) => void;
};

@Injectable()
export class OAuthService {

    redirect_url?: string;

    logout_url?: string;

    auth_url?: string;

    base_url?: string;

    constructor(
        private platform: Platform,
        private authService: AuthService,
        private userProfileService: UserProfileService,
        private buildParamService: BuildParamService,
        private http: Http) {

        this.buildParamService.getBuildConfigParam('BASE_URL')
            .then(baseUrl => {
                this.base_url = baseUrl;
                this.auth_url = baseUrl + "/auth/realms/sunbird/protocol/openid-connect/auth?redirect_uri=" +
                    this.redirect_url + "&response_type=code&scope=offline_access&client_id=${CID}&version=1";
                this.auth_url = this.auth_url.replace("${CID}", this.platform.is("android") ? "android" : "ios");
                this.logout_url = baseUrl + "/auth/realms/sunbird/protocol/openid-connect/logout?redirect_uri=" +
                    this.redirect_url;
                return this.buildParamService.getBuildConfigParam('OAUTH_REDIRECT_URL');
            })
            .then(url => {
                this.redirect_url = url;
            })
            .catch(error => {
            });
    }

    private onOAuthCallback(url: string, resolve, reject) {
        let responseParameters = ((url.split("?")[1]).split("="))[1];
        if (responseParameters !== undefined) {
            resolve(responseParameters);
        } else {
            reject("Problem authenticating with Sunbird");
        }
    }

    doOAuthStepOne(isRTL = false): Promise<any> {

        return new Promise((resolve, reject) => {
            customtabs.isAvailable(() => {
                //customtabs available
                customtabs.launch(this.auth_url!!, callbackUrl => {
                    this.onOAuthCallback(callbackUrl, resolve, reject);
                }, error => {
                    reject(error);
                })
            }, error => {
                //do with in app browser
                let closeCallback = event => {
                    reject("The Sunbird sign in flow was canceled");
                };

                let browserRef = (<any>window).cordova.InAppBrowser.open(this.auth_url, "_blank", "zoom=no");
                browserRef.addEventListener("loadstart", (event) => {
                    if ((event.url).indexOf(this.redirect_url) === 0) {
                        browserRef.removeEventListener("exit", closeCallback);
                        browserRef.close();
                        this.onOAuthCallback(event.url, resolve, reject);
                    }
                });
                if (isRTL) {
                    browserRef.addEventListener('loadstop', (event) => {
                        browserRef.executeScript({ code: "document.body.style.direction = 'rtl'" });
                    });
                }

                browserRef.addEventListener("exit", closeCallback);
            });
        });
    }

    doOAuthStepTwo(token: string): Promise<any> {
        let that = this;

        return new Promise(function (resolve, reject) {
            that.authService.createSession(token, (response) => {
                try {
                    let dataJson = JSON.parse(response);
                    let refreshToken = dataJson["refresh_token"];

                    let accessToken: string = dataJson["access_token"];

                    let value = accessToken.substring(accessToken.indexOf('.') + 1, accessToken.lastIndexOf('.'));
                    (<any>window).GenieSDK.
                        genieSdkUtil.decode(value, 8, decoded => {
                            let json = JSON.parse(decoded);
                            let userToken = json["sub"];

                            that.authService.startSession(accessToken, refreshToken, userToken);

                            let userProfileRequest: UserProfileDetailsRequest = {
                                userId: userToken,
                                requiredFields: ['completeness', 'missingFields', 'lastLoginTime', 'topics']
                            }

                            that.userProfileService.getUserProfileDetails(userProfileRequest, success => {
                                //ignore response or error
                                that.updateLoginTime(accessToken, userToken);

                                resolve();
                            }, error => {

                                // SB-3496 Fix : We need to recosider how to handle the error
                                //ignore response or error
                                that.updateLoginTime(accessToken, userToken);

                                resolve();
                            });

                        }, error => {
                            reject();
                        });

                } catch (error) {
                    reject(error);
                }
            }, (error) => {
                reject(error);
            });
        });
    }

    updateLoginTime(accessToken: string, userToken: string): Promise<any> {
        let that = this;
        return new Promise((resolve, reject) => {
            that.authService.getBearerToken(token => {
                let headers = new Headers({
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'X-Authenticated-User-Token': accessToken,
                    'Authorization': "Bearer " + token
                });
                let options = new RequestOptions({
                    headers: headers,
                    method: RequestMethod.Patch
                });
                let body = {
                    params: {},
                    request: {
                        userId: userToken
                    }
                }
                that.http.patch(that.base_url + "/api/user/v1/update/logintime", body, options)
                    .toPromise()
                    .then(response => {
                        resolve();
                    })
                    .catch(error => {
                        reject(error);
                    });
            }, error => {
                reject(error);
            });
        });
    }

    doLogOut(): Promise<any> {

        return new Promise((resolve, reject) => {
            customtabs.isAvailable(() => {
                customtabs.launch(this.logout_url!!, success => {
                    resolve();
                }, error => {
                    reject();
                });
            }, error => {
                let browserRef = (<any>window).cordova.InAppBrowser.open(this.logout_url);
                browserRef.addEventListener("loadstart", (event) => {
                    if ((event.url).indexOf(this.redirect_url) === 0) {
                        browserRef.removeEventListener("exit", (event) => { });
                        browserRef.close();
                        this.authService.endSession();
                        resolve();
                    }
                });
            });
        });
    }

}