/**
 * Modified MIT License
 * 
 * Copyright 2015 OneSignal
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * 1. The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * 
 * 2. All copies of substantial portions of the Software may only be used in connection
 * with services provided by OneSignal.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
 
// Requires Chrome version 42+

var OneSignal = {
  _VERSION: 9001,
  _HOST_URL: "https://onesignal.com/api/v1/",
  
  _app_id: null,
  
  _tagsToSendOnRegister: null,
  
  _notificationOpened_callback: null,
  _idsAvailable_callback: null,
  
  _defaultLaunchURL: null,
  
  _oneSignal_db: null,

  _init_options: null,
  
  _httpRegistration: false,
  
  _main_page_port: null,
  
  LOGGING: false,

  _log: function(message) {
    if (OneSignal.LOGGING == true)
      console.log(message);
  },
  
  _init_oneSignal_db: function(callback) {
    if (OneSignal._oneSignal_db) {
      callback();
      return;
    }
    
    var request = indexedDB.open("ONE_SIGNAL_SDK_DB", 1);
    request.onsuccess = function(event) {
      OneSignal._oneSignal_db = event.target.result;
      callback();
    };
    
    request.onupgradeneeded = function(event) { 
      var db = event.target.result;
      
      db.createObjectStore("Ids", { keyPath: "type" });
      db.createObjectStore("NotificationOpened", { keyPath: "url" });
      db.createObjectStore("Options", { keyPath: "key" });
    };
  },
  
  _get_db_value(table, key, callback) {
    OneSignal._init_oneSignal_db(function() {
      OneSignal._oneSignal_db.transaction(table).objectStore(table).get(key).onsuccess = callback;
    });
  },
  
  _get_all_values(table, callback) {
    OneSignal._init_oneSignal_db(function() {
      var jsonResult = {};
      OneSignal._oneSignal_db.transaction(table).objectStore(table).openCursor().onsuccess = function(event) {
        var cursor = event.target.result;
        if (cursor) {
          jsonResult[cursor.key] = cursor.value.value;
          cursor.continue();
        }
        else
          callback(jsonResult);
      };
    });
  },
  
  _put_db_value(table, value) {
    OneSignal._init_oneSignal_db(function() {
      OneSignal._oneSignal_db.transaction([table], "readwrite").objectStore(table).put(value);
    });
  },
  
  _delete_db_value(table, key) {
    OneSignal._init_oneSignal_db(function() {
      OneSignal._oneSignal_db.transaction([table], "readwrite").objectStore(table).delete(key);
    });
  },
  
  _sendToOneSignalApi: function(url, action, inData, callback) {
    var contents = {
      method: action,
      //mode: 'no-cors', // no-cors is disabled for non-serviceworker.
    };
    
    if (inData) {
      contents.headers = {"Content-type": "application/json;charset=UTF-8"};
      contents.body = JSON.stringify(inData);
    }
    
    fetch(OneSignal._HOST_URL + url, contents)
    .then(function status(response) {
      if (response.status >= 200 && response.status < 300)
        return Promise.resolve(response);
      else
        return Promise.reject(new Error(response.statusText));
    })
    .then(function status(response) { return response.json(); } )
    .then(function (jsonData) {
      OneSignal._log(jsonData);
      if (callback != null)
        callback(jsonData);
    })
    .catch(function (error) {
      OneSignal._log('Request failed', error);
    });
  },
  
  _getLanguage: function() {
    return navigator.language ? (navigator.language.length > 3 ? navigator.language.substring(0, 2) : navigator.language) : 'en';
  },
  
  _getPlayerId: function(value, callback) {
    if (value)
      callback(value)
    else {
      OneSignal._get_db_value("Ids", "userId", function(event) {
        if (event.target.result)
          callback(event.target.result.id);
      });
    }
  },
  
  _registerWithOneSignal: function(appId, registrationId) {
    OneSignal._get_db_value("Ids", "userId", function(event) {
      var requestUrl = 'players';
      if (event.target.result)
        requestUrl = 'players/' + event.target.result.id + '/on_session';
      
      var jsonData = {app_id: appId,
                      device_type: 5,
                      language: OneSignal._getLanguage(),
                      timezone: new Date().getTimezoneOffset() * -60,
                      device_model: navigator.platform + " Chrome",
                      device_os: navigator.appVersion.match(/Chrome\/(.*?) /)[1],
                      sdk: OneSignal._VERSION};
      
      if (registrationId) {
        jsonData.identifier = registrationId;
        OneSignal._put_db_value("Ids", {type: "registrationId", id: registrationId});
      }
      
      OneSignal._sendToOneSignalApi(requestUrl, 'POST', jsonData,
        function registeredCallback(responseJSON) {
          if (responseJSON.id)
            OneSignal._put_db_value("Ids", {type: "userId", id: responseJSON.id});
          
          OneSignal._getPlayerId(responseJSON.id, function(userId) {
            if (OneSignal._idsAvailable_callback) {
              OneSignal._idsAvailable_callback({userId: userId, registrationId: registrationId});
              OneSignal._idsAvailable_callback = null;
            }
            
            if (OneSignal._httpRegistration) {
              OneSignal._log("Sending player Id and registrationId back to host page");
              OneSignal._log(OneSignal._init_options);
              var creator = opener || parent;
              creator.postMessage({ idsAvailable: {userId: userId, registrationId: registrationId} }, OneSignal._init_options.origin);
              
              if (opener)
                window.close();
            }
            else
              OneSignal._log("NO opener");
          });
        }
      );
    });
  },
  
  setDefaultNotificationUrl: function(url) {
    OneSignal._put_db_value("Options", {key: "defaultUrl", value: url});
  },
  
  setDefaultIcon: function(icon) {
    OneSignal._put_db_value("Options", {key: "defaultIcon", value: icon});
  },
  
  setDefaultTitle: function(title) {
    OneSignal._put_db_value("Options", {key: "defaultTitle", value: title});
  },
  
  _visibilitychange: function() {
    if (document.visibilityState == "visible") {
      document.removeEventListener("visibilitychange", OneSignal._visibilitychange);
      OneSignal._sessionInit();
    }
  },
  
  init: function(options) {
    OneSignal._init_options = options;
    
    window.addEventListener('load', function() {
      OneSignal._get_db_value("Ids", "registrationId", function(event) {
        if (sessionStorage.getItem("ONE_SIGNAL_SESSION"))
          return;
        
        sessionStorage.setItem("ONE_SIGNAL_SESSION", true);
        
        if (OneSignal._init_options.autoRegister == false && !event.target.result)
          return;
        
        if (document.visibilityState != "visible") {
          document.addEventListener("visibilitychange", OneSignal._visibilitychange);
          return;
        }
        
        OneSignal._sessionInit();
      });
    });
  },
  
  registerForPushNotifications(options) {
    // Warning: Do not add callbacks that have to fire to get from here to window.open in _sessionInit otherwise the pop-up will be blocked by chrome.
    if (!options)
      options = {};
    options.fromRegisterFor = true;
    OneSignal._sessionInit(options);
  },
  
  // Http only - Only called from iframe's init.js
  _initHttp: function(options) {
    OneSignal._init_options = options;
    
    var creator = opener || parent;
    
    if (creator) {
      var messageChannel = new MessageChannel();
      messageChannel.port1.onmessage = function(event) {
        OneSignal._log("_initHttp.messageChannel.port1.onmessage", event);
        if (event.data.initOptions) {
          OneSignal.setDefaultNotificationUrl(event.data.initOptions.defaultUrl);
          OneSignal.setDefaultTitle(event.data.initOptions.defaultTitle);
          if (event.data.initOptions.defaultIcon)
            OneSignal.setDefaultIcon(event.data.initOptions.defaultIcon);
          
          OneSignal._log("document.URL", event.data.initOptions.parent_url);
          OneSignal._get_db_value("NotificationOpened", event.data.initOptions.parent_url, function(value) {
            OneSignal._log("_initHttp NotificationOpeed db", value);
            if (value.target.result) {
              OneSignal._delete_db_value("NotificationOpened", event.data.initOptions.parent_url);
              OneSignal._log("creator.postMessage");
              creator.postMessage({openedNotification: value.target.result.data}, OneSignal._init_options.origin);
            }
          });
        }
      };
      
      creator.postMessage({oneSignalInitPageReady: true}, OneSignal._init_options.origin, [messageChannel.port2]);
    }
    
    OneSignal._initSaveState();
    OneSignal._httpRegistration = true;
    OneSignal._log("Before navigator.serviceWorker.register");
    navigator.serviceWorker.register('OneSignalSDKWorker.js').then(OneSignal._enableNotifications, OneSignal._registerError);
    OneSignal._log("After navigator.serviceWorker.register");
  },
  
  _initSaveState: function() {
    OneSignal._app_id = OneSignal._init_options.appId;
    OneSignal._put_db_value("Ids", {type: "appId", id: OneSignal._app_id});
    OneSignal._put_db_value("Options", {key: "pageTitle", value: document.title});
  },
  
  _sessionInit: function(options) {
    if ('serviceWorker' in navigator && navigator.userAgent.toLowerCase().indexOf('chrome') > -1) {
      OneSignal._initSaveState();
      
      var fromRegisterFor = options && options.fromRegisterFor;
      
      // HTTP support in a future release
      /*
      if (location.protocol === 'http:') {
        if (fromRegisterFor) {
          // TODO: Change to 'https://' + OneSignal._init_options.subdomainName + '.onesignal.com/init.html'
          window.open('https://onesignal.com/ChromeWebExample/init.html', "_blank", "toolbar=no, scrollbars=no, width=308, height=122"); 
        } 
        else {
          OneSignal._get_db_value("Ids", "userId", function(userIdEvent) {
            if (userIdEvent.target.result) {
              var node = document.createElement("iframe");
              node.style.display = "none";
              node.src = "https://onesignal.com/ChromeWebExample/init.html"; // TODO: Set to 'https://' + OneSignal._init_options.subdomainName + '.onesignal.com/ChromeWebExample/init.html'
              document.body.appendChild(node);
            }
          });
        }
        return;
      }*/
      
      OneSignal._get_db_value("Ids", "registrationId", function(event) {
        if (!event.target.result || !fromRegisterFor) {
          navigator.serviceWorker.getRegistration().then(function (event) {
            var sw_path = "";
            
            if (OneSignal._init_options.path)
              sw_path = OneSignal._init_options.path;
             
            if (typeof event === "undefined") // Nothing registered, very first run
              navigator.serviceWorker.register(sw_path + 'OneSignalSDKWorker.js').then(OneSignal._enableNotifications, OneSignal._registerError);
            else {
              if (event.active) {
                if (event.active.scriptURL.indexOf(sw_path + "OneSignalSDKWorker.js") > -1) {
                  OneSignal._get_db_value("Ids", "WORKER1_ONE_SIGNAL_SW_VERSION", function(version) {
                    if (version.target.result) {
                      if (version.target.result.id != OneSignal._VERSION) {
                        event.unregister().then(function () {
                          navigator.serviceWorker.register(sw_path + 'OneSignalSDKUpdaterWorker.js').then(OneSignal._enableNotifications, OneSignal._registerError);
                        });
                      }
                      else
                        navigator.serviceWorker.register(sw_path + 'OneSignalSDKWorker.js').then(OneSignal._enableNotifications, OneSignal._registerError);
                    }
                    else
                      navigator.serviceWorker.register(sw_path + 'OneSignalSDKWorker.js').then(OneSignal._enableNotifications, OneSignal._registerError);
                  });
                }
                else if (event.active.scriptURL.indexOf(sw_path + "OneSignalSDKUpdaterWorker.js") > -1) {
                  OneSignal._get_db_value("Ids", "WORKER2_ONE_SIGNAL_SW_VERSION", function(version) {
                    if (version.target.result) {
                      if (version.target.result.id != OneSignal._VERSION) {
                        event.unregister().then(function () {
                          navigator.serviceWorker.register(sw_path + 'OneSignalSDKWorker.js').then(OneSignal._enableNotifications, OneSignal._registerError);
                        });
                      }
                      else
                        navigator.serviceWorker.register(sw_path + 'OneSignalSDKUpdaterWorker.js').then(OneSignal._enableNotifications, OneSignal._registerError);
                    }
                    else
                      navigator.serviceWorker.register(sw_path + 'OneSignalSDKUpdaterWorker.js').then(OneSignal._enableNotifications, OneSignal._registerError);
                  });
                }
              }
              else if (event.installing == null)
                navigator.serviceWorker.register(sw_path + 'OneSignalSDKWorker.js').then(OneSignal._enableNotifications, OneSignal._registerError);
            }
          }).catch(function (error) {
            OneSignal._log("ERROR Getting registration: " + error);
          });
        }
      });
    }
    else
      OneSignal._log('Service workers are not supported in this browser.');
  },
  
  _registerError: function(err) {
    OneSignal._log("navigator.serviceWorker.register:ERROR: " + err);
  },
  
  _enableNotifications: function(existingServiceWorkerRegistration) { // is ServiceWorkerRegistration type
    OneSignal._log("_enableNotifications: ", existingServiceWorkerRegistration);
    
    if (!('PushManager' in window)) {
      OneSignal._log("Push messaging is not supported.");
      return;
    }
    
    if (!('showNotification' in ServiceWorkerRegistration.prototype)) {  
      OneSignal._log("Notifications are not supported.");
      return;
    }
    
    if (Notification.permission === 'denied') {
      OneSignal._log("The user has disabled notifications.");
      return;
    }
    
    navigator.serviceWorker.ready.then(function(serviceWorkerRegistration) {
      OneSignal._log(serviceWorkerRegistration);
      
      OneSignal._subscribeForPush(serviceWorkerRegistration);
    });
  },
  
  _subscribeForPush: function(serviceWorkerRegistration) {
    OneSignal._log("navigator.serviceWorker.ready.then");
    
    serviceWorkerRegistration.pushManager.subscribe()
    .then(function(subscription) {
      OneSignal._get_db_value("Ids", "appId", function(event) {
        appId = event.target.result.id
        OneSignal._log("serviceWorkerRegistration.pushManager.subscribe()");
        
        var registrationId = null;
        if (subscription) {
          registrationId = subscription.subscriptionId;
          OneSignal._log('registration id is:' + registrationId);
        }
        else
          OneSignal._log('Error could not subscribe to GCM!');
        
        OneSignal._registerWithOneSignal(appId, registrationId);
      });
    })
    .catch(function(err) {
      OneSignal._log('Error during subscribe()');
      OneSignal._log(err);
      if (err.code == 20 && opener)
        window.close();
    });
  },
  
  sendTag: function(key, value) {
    jsonKeyValue = {};
    jsonKeyValue[key] = value;
    OneSignal.sendTags(jsonKeyValue);
  },
  
  sendTags: function(jsonPair) {
    OneSignal._get_db_value("Ids", "userId", function(event) {
      if (event.target.result)
        OneSignal._sendToOneSignalApi("players/" + event.target.result.id, "PUT", {app_id: OneSignal._app_id, tags: jsonPair});
      else {
        if (OneSignal._tagsToSendOnRegister == null)
          OneSignal._tagsToSendOnRegister = jsonPair;
        else
          OneSignal._tagsToSendOnRegister = OneSignal._tagsToSendOnRegister.concat(jsonPair);
      }
    });
  },
  
  deleteTag: function(key) {
    OneSignal.deleteTags([key]);
  },
  
  deleteTags: function(keyArray) {
    var jsonPair = {};
    var length = keyArray.length;
    for (var i = 0; i < length; i++)
      jsonPair[keyArray[i]] = "";
    
    OneSignal.sendTags(jsonPair);
  },
  
  _handleNotificationOpened: function(event) {
    var notificationData = JSON.parse(event.notification.tag);
    event.notification.close();
    
    OneSignal._get_db_value("Ids", "appId", function(appIdEvent) {
      if (appIdEvent.target.result) {
        OneSignal._get_db_value("Ids", "userId", function(userIdEvent) {
          if (userIdEvent.target.result) {
            OneSignal._sendToOneSignalApi("notifications/" + notificationData.id, "PUT",
              {app_id: appIdEvent.target.result.id, player_id: userIdEvent.target.result.id, opened: true});
          }
        });
      }
    });
    
    event.waitUntil(
      clients.matchAll({type: "window"})
      .then(function(clientList) {
        var launchURL = registration.scope;
        if (OneSignal._defaultLaunchURL)
          launchURL = OneSignal._defaultLaunchURL;
        if (notificationData.launchURL)
          launchURL = notificationData.launchURL;
        
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if ('focus' in client && client.url == launchURL) {
            client.focus();
            
            // Seems to only work if we leave off the targetOrigin param.
            client.postMessage(notificationData);
            return;
          }
        }
        
        OneSignal._put_db_value("NotificationOpened", {url: launchURL, data: notificationData});
        clients.openWindow(launchURL).catch(function(error) {
          clients.openWindow(registration.scope + "redirector.html?url=" + launchURL);
        });
      })
    );
  },
  
  _getTitle: function(incomingTitle, callback) {
    if (incomingTitle != null) {
      callback(incomingTitle);
      return;
    }
    
    OneSignal._get_db_value("Options", "defaultTitle", function(event) {
      if (event.target.result) {
        callback(event.target.result.value);
        return;
      }
      
      OneSignal._get_db_value("Options", "pageTitle", function(event) {
        if (event.target.result && event.target.result.value != null) {
          callback(event.target.result.value);
          return;
        }
        
        callback("");
      });
    });
  },
  
  _handleGCMMessage(serviceWorker, event) {
    // TODO: Read data from the GCM payload when Chrome no longer requires the below command line parameter.
    // --enable-push-message-payload
    // The command line param is required even on Chrome 43 nightly build 2015/03/17.
    if (event.data && event.data.text()[0] == "{") {
      OneSignal._log('Received data.text: ', event.data.text());
      OneSignal._log('Received data.json: ', event.data.json());
    }
    
    OneSignal._getLastNotification(function(response, appId) {
      var notificationData = {
        id: response.custom.i,
        message: response.alert,
        additionalData: response.custom.a
      };
      
      if (response.custom.u)
        notificationData.launchURL = response.custom.u;
      
      OneSignal._getTitle(response.title, function(title) {
        notificationData.title = title;
        OneSignal._get_db_value("Options", "defaultIcon", function(event) {
          var icon = null;
          if (event.target.result)
            icon = event.target.result.value;
          
          if (response.icon) {
            icon = response.icon;
            notificationData.icon = response.icon;
          }
          
          serviceWorker.registration.showNotification(title, {
            body: response.alert,
            icon: icon,
            tag: JSON.stringify(notificationData)
          });
        });
      });
      
      OneSignal._get_db_value("Options", "defaultUrl", function(event) {
        if (event.target.result)
          OneSignal._defaultLaunchURL = event.target.result.value;
      });
    });
  },
  
  _getLastNotification: function(callback) {
    OneSignal._get_db_value("Ids", "appId", function(event) {
      if (event.target.result) {
        OneSignal._sendToOneSignalApi("apps/" + event.target.result.id + "/last_chromeweb_notification?language=" + OneSignal._getLanguage(), "GET", null, function(response) {
          callback(response);
        });
      }
      else
        OneSignal._log("Error: could not get notificationId");
    });
  },
  
  // HTTP & HTTPS - Runs on main page
  _listener_receiveMessage: function receiveMessage(event) {
    OneSignal._log("_listener_receiveMessage: ", event);
    
    if (event.origin !== "" && event.origin !== "https://onesignal.com")
      return;
    
    if (event.data.oneSignalInitPageReady) {
      OneSignal._get_all_values("Options", function(options) {
        OneSignal._log("current options", options);
        if (!options.defaultUrl)
          options.defaultUrl = document.URL;
        if (!options.defaultTitle)
          options.defaultTitle = document.title;
        
        options.parent_url = document.URL;
        OneSignal._log("Posting message to port[0]", event.ports[0]);
        // TODO: Change to 'https://' + OneSignal._init_options.subdomainName + '.onesignal.com'
        event.ports[0].postMessage({initOptions: options});
      });
    }
    else if (event.data.idsAvailable) {
      OneSignal._put_db_value("Ids", {type: "userId", id: event.data.idsAvailable.userId});
      OneSignal._put_db_value("Ids", {type: "registrationId", id: event.data.idsAvailable.registrationId});
      
      if (OneSignal._idsAvailable_callback) {
        OneSignal._idsAvailable_callback({userId: event.data.idsAvailable.userId, registrationId: event.data.idsAvailable.registrationId});
        OneSignal._idsAvailable_callback = null;
      }
    }
    else if (OneSignal._notificationOpened_callback)
      OneSignal._notificationOpened_callback(event.data);
  },
  
  addListenerForNotificationOpened: function(callback) {
    OneSignal._notificationOpened_callback = callback;
    if (window) {
      OneSignal._get_db_value("NotificationOpened", document.URL, function(value) {
        if (value.target.result) {
          OneSignal._delete_db_value("NotificationOpened", document.URL);
          OneSignal._notificationOpened_callback(value.target.result.data);
        }
      });
    }
  },
  
  getIdsAvailable: function(callback) {
    OneSignal._idsAvailable_callback = callback;
    
    OneSignal._get_db_value("Ids", "userId", function(userIdEvent) {
      if (userIdEvent.target.result) {
        OneSignal._get_db_value("Ids", "registrationId", function(registrationIdEvent) {
          if (registrationIdEvent.target.result) {
            callback({userId: userIdEvent.target.result.id, registrationId: registrationIdEvent.target.result.id});
            OneSignal._idsAvailable_callback = null;
          }
          else
            callback({userId: userIdEvent.target.result.id, registrationId: null});
        });
      }
    });
  },
  
  getTags: function(callback) {
    OneSignal._get_db_value("Ids", "userId", function(userIdEvent) {
      if (userIdEvent.target.result) {
        OneSignal._sendToOneSignalApi("players/" + userIdEvent.target.result.id, 'GET', null, function(response) {
          callback(response.tags);
        });
      }
    });
  }
};

// If imported on your page.
if (typeof  window !== "undefined")
  window.addEventListener("message", OneSignal._listener_receiveMessage, false);
else { // if imported from the service worker.
  self.addEventListener('push', function(event) {
    OneSignal._handleGCMMessage(self, event);
  });
  self.addEventListener('notificationclick', function(event) {
    OneSignal._handleNotificationOpened(event);
  });
  self.addEventListener('install', function(event) {
    OneSignal._log("OneSignal Installed service worker: " + OneSignal._VERSION);
    if (self.location.pathname.indexOf("OneSignalSDKWorker.js") > -1)
      OneSignal._put_db_value("Ids", {type: "WORKER1_ONE_SIGNAL_SW_VERSION", id: OneSignal._VERSION});
    else
      OneSignal._put_db_value("Ids", {type: "WORKER2_ONE_SIGNAL_SW_VERSION", id: OneSignal._VERSION});
  });
}