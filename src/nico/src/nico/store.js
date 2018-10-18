import { TEMPLATES, LANGUAGES } from './constants'
import { getCanvasFromData } from '../image-editor/helpers.js'
import generateSet from '@/generateSet'
import * as languages from './languages'

// inline loader syntax used because otherwise this loader doesn't work
// eslint-disable-next-line import/no-webpack-loader-syntax
import mars from '!raw-loader!./mars.raw'

export default {
  namespaced: true,

  state: {
    code: window.localStorage.getItem('code') || '',
    errors: [],
    warnings: [],
    view: window.localStorage.getItem('view') || 'game',
    paused: false,
    running: false,
    mainCtx: null,
    hasBeenRun: false,
    language: languages.Python,
    loading: false,
    loadingTime: null,
    clicks: 0,
  },

  getters: {
    pauseDisabled (state) {
      return !state.running
    },

    hasClickedTooMuch (state) {
      return state.clicks > 20
    },
  },

  mutations: {
    ...generateSet(['errors', 'warnings', 'loading', 'loadingTime', 'mainCtx', 'paused', 'clicks']),

    setLanguage (state, language) {
      state.language = new languages[language](mars)
    },

    setView (state, view) {
      state.view = view
      if (state.running) {
        state.paused = true
      }
      window.localStorage.setItem('view', state.view)
    },
    togglePause (state) {
      state.paused = !state.paused
      if (!state.paused) {
        state.view = 'game'
      }
    },
    setCode (state, code) {
      state.code = code
      window.localStorage.setItem('code', state.code)
    },
    setRunning (state, running) {
      state.running = running
      state.hasBeenRun = true
    },
    loadBoilerplate (state) {
      state.code = TEMPLATES[LANGUAGES[state.language.constructor.name]]
    },
  },

  actions: {
    run ({ state, commit, rootGetters, rootState, getters }) {
      commit('setClicks', state.clicks + 1)
      if (state.loading) return

      commit('setView', 'game')
      commit('setRunning', false)
      commit('setErrors', [])
      commit('setLoading', false)
      window.onerror = (message, source, lineno, colno, error) => {
        commit('setErrors', [
          state.language.convertWindowError({ message, source, lineno, colno, error }),
        ])
        commit('setRunning', false)
      }

      // this timeout is necessary for vuex to register the change in `loading`
      setTimeout(() => {
        if (state.language.needsLoading) {
          commit('setLoading', true)
          state.language
            .getLoadingTime(this.apolloClient)
            .then((time) => commit('setLoadingTime', time))
        }
        state.language
          .prepareCode(state.code, this.apolloClient)
          .then(({ success, code, errors, warnings, blocked }) => {
            commit('setLoading', false)
            commit('setWarnings', warnings || [])
            commit('setClicks', 0)

            if (success) {
              commit('setRunning', true)
              commit('setPaused', false)

              /* eslint-disable no-unused-vars */
              const variables = {
                _state: state,
                _ctx: state.mainCtx,
                _sprites: rootGetters['sprite/sprite/sprites'],
                _clear: true,
                _tilemap: getCanvasFromData(rootGetters['tile/sprite/spritesheetDisplay']()),
              }
              /* eslint-enable no-unused-vars */

              try {
                // keys: variable names, values: variable values, this is a way to scope values
                // eslint-disable-next-line no-new-func
                new Function(...Object.keys(variables), code)(...Object.values(variables))
              } catch (e) {
                // most errors occur in the window scope and are caught by window.onerror, but a very small amount don't
                // one example: python runtime error that occurs in the global scope
                // because that's the only instance I've detected so far, a language does not have to implement this handler

                // is standard js error
                if (e.message) {
                  commit('setErrors', [e])
                  commit('setRunning', false)
                  // is weird language-specific area and handler implemented
                } else if (state.language.convertError) {
                  commit('setErrors', [state.language.convertError(e)])
                  commit('setRunning', false)
                }
              }
            } else if (!blocked) {
              commit('setErrors', errors)
            }
          })
      }, 0)
    },
  },
}
